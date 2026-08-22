-- =============================================================================
-- hr_punch_state() now reports the caller's OWN detected address.
--
-- The Office Networks screen needs to tell an admin what the server currently
-- sees them as, so adding the office IP is one click rather than a trip to a
-- "what is my IP" site and a retype. Getting that value from anywhere other
-- than this function would risk the hint disagreeing with the value
-- enforcement actually uses.
--
-- This is not a disclosure: it is the caller's own public IP, which any website
-- they visit already learns. What stays hidden is the ALLOWLIST -- which
-- addresses are approved -- because an employee who could enumerate that would
-- know exactly what to spoof. hr_allowed_networks remains HR-readable only, and
-- this function still reports only a verdict about the current address, never
-- the list.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_punch_state(p_employee_id uuid, p_detected_ip inet DEFAULT NULL)
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
BEGIN
  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;

  SELECT COALESCE(network_exempt, false) INTO v_exempt
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

  RETURN jsonb_build_object(
    'work_date',        v_date,
    'server_time',      now(),
    'detected_ip',      p_detected_ip::text,
    'punched_in',       COALESCE(v_last.punch_type = 'in', false),
    'next_action',      CASE WHEN COALESCE(v_last.punch_type, 'out') = 'in' THEN 'out' ELSE 'in' END,
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
    'can_punch',        (COALESCE(s.enforcement_mode, 'observe') = 'observe'
                          OR v_net_status = 'office' OR COALESCE(v_exempt, false)),
    'timeline',        COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'type', punch_type, 'at', punched_at,
               'network', network_status, 'approval', approval_status)
             ORDER BY punched_at)
      FROM hr_attendance_punches
      WHERE employee_id = p_employee_id AND work_date = v_date), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.hr_punch_state(uuid, inet) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_punch_state(uuid, inet) TO service_role;