-- =============================================================================
-- Enforce the punch window inside hr_record_punch().
--
-- Server-side, in the same transaction as the punch, for the same reason the
-- network check is: a rule the browser applies is a rule anyone can skip by
-- calling the endpoint directly. The refusal is returned as data, so the
-- employee gets a sentence naming the permitted hours instead of an error.
--
-- The window is checked BEFORE the network verdict. Someone punching at 03:00
-- from home should be told the office is not open to punches yet, not that
-- their Wi-Fi is wrong -- the first is actionable, the second is a red herring.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_record_punch(
  p_employee_id   uuid,
  p_punch_type    text,
  p_detected_ip   inet,
  p_forwarded_for text DEFAULT '',
  p_user_agent    text DEFAULT '',
  p_source        text DEFAULT 'web'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s              record;
  prof           record;
  v_now          timestamptz := clock_timestamp();
  v_date         date;
  v_network_id   uuid;
  v_network_name text := '';
  v_net_status   text;
  v_approval     text;
  v_last         record;
  v_recent       integer;
  v_today_count  integer;
  v_punch_id     uuid;
  v_sched        uuid;
  v_loc          text;
BEGIN
  v_date := hr_ist_date(v_now);

  IF p_punch_type NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_TYPE', 'message', 'Unknown punch type.');
  END IF;

  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_CONFIGURED',
      'message', 'Attendance has not been set up yet. Please contact HR.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 42));

  SELECT e.status,
         COALESCE(pr.network_exempt, false)       AS network_exempt,
         COALESCE(pr.employment_status, 'active') AS employment_status,
         pr.exit_date,
         pr.work_schedule_id,
         COALESCE(pr.holiday_location, 'Chennai') AS holiday_location
    INTO prof
  FROM nw_employees e
  LEFT JOIN hr_employee_profiles pr ON pr.employee_id = e.id
  WHERE e.id = p_employee_id;

  IF NOT FOUND OR prof.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE',
      'message', 'Your employee record is not active. Please contact HR.');
  END IF;

  IF prof.exit_date IS NOT NULL AND v_date > prof.exit_date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EXITED',
      'message', 'Attendance is closed for this employee record.');
  END IF;

  -- ---- Permitted hours -------------------------------------------------
  -- Punch-outs are exempt unless an admin has deliberately said otherwise:
  -- refusing one cannot un-work the time, and leaves the person punched in.
  IF p_punch_type = 'in' OR NOT s.allow_out_punch_anytime THEN
    IF NOT hr_within_punch_window(v_now) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE_HOURS',
        'window_start', to_char(s.punch_window_start, 'HH12:MI AM'),
        'window_end',   to_char(s.punch_window_end,   'HH12:MI AM'),
        'message', format(
          'Attendance can only be punched between %s and %s. If you are working outside these hours, ask an administrator to record it as an attendance correction.',
          to_char(s.punch_window_start, 'FMHH12:MI AM'),
          to_char(s.punch_window_end,   'FMHH12:MI AM')));
    END IF;

    -- Non-working DAYS, both off by default. Someone who comes in on a
    -- Saturday is doing work; refusing the punch does not undo the work, it
    -- just loses the record of it.
    IF s.block_on_weekly_off AND hr_is_weekly_off(prof.work_schedule_id, v_date) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'WEEKLY_OFF',
        'message', 'Today is a weekly off, so attendance cannot be punched. Ask an administrator if you are working today.');
    END IF;

    IF s.block_on_holiday AND hr_is_holiday(prof.holiday_location, v_date) IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'HOLIDAY',
        'message', 'Today is a holiday, so attendance cannot be punched. Ask an administrator if you are working today.');
    END IF;
  END IF;

  -- ---- Network verdict (server-side, always) ----------------------------
  IF p_detected_ip IS NULL THEN
    v_net_status := 'unknown';
  ELSE
    v_network_id := hr_match_network(p_detected_ip);
    IF v_network_id IS NOT NULL THEN
      SELECT name INTO v_network_name FROM hr_allowed_networks WHERE id = v_network_id;
      v_net_status := 'office';
    ELSE
      v_net_status := 'off_network';
    END IF;
  END IF;

  IF s.enforcement_mode = 'observe' OR v_net_status = 'office' OR prof.network_exempt THEN
    v_approval := 'auto_approved';
  ELSE
    v_approval := 'pending';
  END IF;

  -- ---- Abuse control ----------------------------------------------------
  SELECT count(*) INTO v_recent
  FROM hr_attendance_punches
  WHERE employee_id = p_employee_id AND punched_at > v_now - interval '1 minute';

  IF v_recent >= s.rate_limit_per_minute THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMIT',
      'message', 'Too many attempts. Please wait a moment and try again.');
  END IF;

  SELECT count(*) INTO v_today_count
  FROM hr_attendance_punches
  WHERE employee_id = p_employee_id AND work_date = v_date;

  IF v_today_count >= s.max_punches_per_day THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TOO_MANY',
      'message', 'You have reached the maximum number of punches for today. Please contact HR.');
  END IF;

  -- ---- Sequence + cooldown ----------------------------------------------
  SELECT punch_type, punched_at INTO v_last
  FROM hr_attendance_punches
  WHERE employee_id = p_employee_id AND work_date = v_date
    AND approval_status <> 'rejected'
  ORDER BY punched_at DESC
  LIMIT 1;

  IF FOUND AND s.punch_cooldown_seconds > 0
     AND v_now - v_last.punched_at < make_interval(secs => s.punch_cooldown_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COOLDOWN',
      'message', 'This attendance punch has already been recorded. Please refresh the page and try again.');
  END IF;

  IF p_punch_type = 'in' AND FOUND AND v_last.punch_type = 'in' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_IN',
      'message', 'You are already punched in. Punch out first.');
  END IF;

  IF p_punch_type = 'out' AND (NOT FOUND OR v_last.punch_type = 'out') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_IN',
      'message', 'You have not punched in yet today.');
  END IF;

  -- ---- Record -----------------------------------------------------------
  INSERT INTO hr_attendance_punches (
    employee_id, punch_type, punched_at, work_date,
    detected_ip, forwarded_for, network_id, network_name, network_status,
    approval_status, user_agent, source, enforcement_mode)
  VALUES (
    p_employee_id, p_punch_type, v_now, v_date,
    p_detected_ip, left(COALESCE(p_forwarded_for, ''), 500), v_network_id,
    COALESCE(v_network_name, ''), v_net_status,
    v_approval, left(COALESCE(p_user_agent, ''), 300), COALESCE(p_source, 'web'),
    s.enforcement_mode)
  RETURNING id INTO v_punch_id;

  PERFORM hr_recompute_daily(p_employee_id, v_date);

  INSERT INTO hr_audit_logs (actor_employee_id, actor_name, actor_role, entity, entity_id,
                             action, after_value, ip, user_agent)
  SELECT p_employee_id, e.full_name, e.role, 'attendance', v_punch_id,
         'punch_' || p_punch_type,
         jsonb_build_object('network_status', v_net_status, 'network', v_network_name,
                            'approval', v_approval, 'mode', s.enforcement_mode),
         p_detected_ip, left(COALESCE(p_user_agent, ''), 300)
  FROM nw_employees e WHERE e.id = p_employee_id;

  RETURN jsonb_build_object(
    'ok', true,
    'punch_id', v_punch_id,
    'punch_type', p_punch_type,
    'punched_at', v_now,
    'work_date', v_date,
    'network_status', v_net_status,
    'network_name', COALESCE(v_network_name, ''),
    'approval_status', v_approval,
    'enforcement_mode', s.enforcement_mode,
    'message', CASE
      WHEN v_approval = 'pending'
        THEN 'Recorded, but you are outside the approved office network. This punch needs admin approval before it counts.'
      WHEN p_punch_type = 'in'  THEN 'Punched in.'
      ELSE 'Punched out.'
    END);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_record_punch(uuid, text, inet, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_record_punch(uuid, text, inet, text, text, text)
  TO service_role;

-- --- Let the punch card show the rule before the button is pressed ---------
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
    -- Punch-window state, so the card can explain itself before the press.
    'window_enforced',  COALESCE(s.enforce_punch_window, false),
    'window_start',     s.punch_window_start,
    'window_end',       s.punch_window_end,
    'within_window',    v_in_window,
    'day_blocked',      v_day_blocked,
    -- Whether THIS action would be refused on time-of-day grounds. A punch-out
    -- is normally exempt, so someone working late still sees an enabled button.
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

REVOKE ALL ON FUNCTION public.hr_punch_state(uuid, inet) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_punch_state(uuid, inet) TO service_role;