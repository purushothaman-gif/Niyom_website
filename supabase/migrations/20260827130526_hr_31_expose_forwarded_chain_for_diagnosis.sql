-- =============================================================================
-- Show the admin what the server actually sees.
--
-- The proxy-hop setting was wrong for four days and nothing said so. The symptom
-- reached the user as "it keeps asking me to trust a new IP"; the cause was that
-- the right-most X-Forwarded-For entry is Supabase's own AWS hop, which rotates
-- per request. Everything needed to spot it was already being stored on each
-- punch -- the raw chain -- and nothing put it on a screen.
--
-- So the Office Networks tab now shows the full chain alongside the address that
-- was chosen from it. An address that does not look like the office is then
-- obvious at a glance, instead of being inferred from a pattern of approval
-- prompts days later.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_punch_state(
  p_employee_id uuid,
  p_detected_ip inet DEFAULT NULL,
  p_forwarded_for text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s            record;
  v_date       date := hr_ist_date(now());
  v_last       record;
  v_daily      record;
  v_network_id uuid;
  v_net_name   text := '';
  v_net_status text;
  v_exempt     boolean;
  v_sched      uuid;
  v_loc        text;
  v_in_window  boolean;
  v_next       text;
  v_day_blocked boolean := false;
BEGIN
  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;

  SELECT COALESCE(network_exempt, false), work_schedule_id, COALESCE(holiday_location, 'Chennai')
    INTO v_exempt, v_sched, v_loc
  FROM hr_employee_profiles WHERE employee_id = p_employee_id;

  IF p_detected_ip IS NULL THEN
    v_net_status := 'unknown';
  ELSE
    v_network_id := hr_match_network(p_detected_ip);
    IF v_network_id IS NOT NULL THEN
      SELECT name INTO v_net_name FROM hr_allowed_networks WHERE id = v_network_id;
      v_net_status := 'office';
    ELSE
      v_net_status := 'off_network';
    END IF;
  END IF;

  SELECT punch_type, punched_at, approval_status INTO v_last
  FROM hr_attendance_punches
  WHERE employee_id = p_employee_id AND work_date = v_date AND approval_status <> 'rejected'
  ORDER BY punched_at DESC LIMIT 1;

  SELECT * INTO v_daily
  FROM hr_attendance_daily WHERE employee_id = p_employee_id AND work_date = v_date;

  v_next := CASE WHEN COALESCE(v_last.punch_type, 'out') = 'in' THEN 'out' ELSE 'in' END;
  v_in_window := hr_within_punch_window(now());

  IF COALESCE(s.block_on_weekly_off, false) AND hr_is_weekly_off(v_sched, v_date) THEN
    v_day_blocked := true;
  END IF;
  IF COALESCE(s.block_on_holiday, false) AND hr_is_holiday(v_loc, v_date) IS NOT NULL THEN
    v_day_blocked := true;
  END IF;

  RETURN jsonb_build_object(
    'work_date',        v_date,
    'server_time',      now(),
    'detected_ip',      p_detected_ip::text,
    -- The whole chain, and the setting that decided which entry was taken.
    -- Diagnostic only: an admin sees it on the Office Networks tab, and the
    -- allowlist itself is still never exposed.
    'forwarded_for',    p_forwarded_for,
    'trusted_proxy_hops', COALESCE(s.trusted_proxy_hops, 0),
    'punched_in',       COALESCE(v_last.punch_type = 'in', false),
    'next_action',      v_next,
    'last_punch_at',    v_last.punched_at,
    'first_in_at',      v_daily.first_in_at,
    'last_out_at',      v_daily.last_out_at,
    'worked_minutes',   COALESCE(v_daily.worked_minutes, 0),
    'status',           COALESCE(v_daily.status, 'absent'),
    'is_late',          COALESCE(v_daily.is_late, false),
    'late_minutes',     COALESCE(v_daily.late_minutes, 0),
    'has_pending_punch',COALESCE(v_daily.has_pending_punch, false),
    'network_status',   v_net_status,
    'network_name',     COALESCE(v_net_name, ''),
    'network_exempt',   COALESCE(v_exempt, false),
    'enforcement_mode', COALESCE(s.enforcement_mode, 'observe'),
    'office_start',     s.office_start,
    'office_end',       s.office_end,
    'window_enforced',  COALESCE(s.enforce_punch_window, false),
    'window_start',     s.punch_window_start,
    'window_end',       s.punch_window_end,
    'within_window',    v_in_window,
    'day_blocked',      v_day_blocked,
    'window_blocks_next', (NOT v_in_window OR v_day_blocked)
                          AND (v_next = 'in' OR NOT COALESCE(s.allow_out_punch_anytime, true)),
    'can_punch',        (COALESCE(s.enforcement_mode, 'observe') = 'observe'
                          OR v_net_status = 'office' OR COALESCE(v_exempt, false))
                        AND NOT ((NOT v_in_window OR v_day_blocked)
                                 AND (v_next = 'in' OR NOT COALESCE(s.allow_out_punch_anytime, true))),
    'timeline',        COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'type', punch_type, 'at', punched_at,
               'network', network_status, 'approval', approval_status)
             ORDER BY punched_at)
      FROM hr_attendance_punches
      WHERE employee_id = p_employee_id AND work_date = v_date), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.hr_punch_state(uuid, inet, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_punch_state(uuid, inet, text) TO service_role;

-- The two-argument form is replaced by the three-argument one above.
DROP FUNCTION IF EXISTS public.hr_punch_state(uuid, inet);