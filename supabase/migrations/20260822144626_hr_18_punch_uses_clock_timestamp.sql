-- =============================================================================
-- Fix: hr_record_punch() stamped punched_at with now(), which in Postgres is
-- TRANSACTION START time and therefore identical for every statement in the
-- same transaction. Two punches recorded in one transaction collided on
-- hr_punches_no_exact_dupe and surfaced a raw 23505 instead of a real refusal.
--
-- In production each punch is its own request, so this was not reachable from
-- the app -- but it made the dedupe index meaningless (it can only ever catch
-- an exact instant collision) and it recorded the transaction's start rather
-- than the moment the button was pressed.
--
-- clock_timestamp() reads the actual wall clock. Still server-side; the client
-- has no say in the time either way.
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
         COALESCE(pr.network_exempt, false)   AS network_exempt,
         COALESCE(pr.employment_status, 'active') AS employment_status,
         pr.exit_date
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