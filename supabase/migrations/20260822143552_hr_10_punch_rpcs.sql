-- =============================================================================
-- NIYOM HR & PAYROLL -- 10: punching and attendance review
--
-- hr_record_punch() is executable by service_role ONLY. That is the entire
-- point: the detected IP is an argument, so anything that could call it
-- directly could name its own IP. The only caller is the hr-attendance-punch
-- edge function, which derives the IP from the request headers and never from
-- the request body.
--
-- Refusals are returned as data ({ok:false, code, message}) rather than raised,
-- so the edge function can map them to a sentence a human understands and the
-- transaction is not aborted on an ordinary "you are already punched in".
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
  v_now          timestamptz := now();
  v_date         date := hr_ist_date(now());
  v_network_id   uuid;
  v_network_name text := '';
  v_net_status   text;
  v_approval     text;
  v_last         record;
  v_recent       integer;
  v_today_count  integer;
  v_punch_id     uuid;
BEGIN
  IF p_punch_type NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_TYPE', 'message', 'Unknown punch type.');
  END IF;

  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_CONFIGURED',
      'message', 'Attendance has not been set up yet. Please contact HR.');
  END IF;

  -- Serialise this employee's punches. Two taps on a slow connection, or the
  -- same page open on a phone and a laptop, otherwise race past the sequence
  -- and cooldown checks below.
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

  -- observe : record the truth, never block -- this is how the real office IPs
  --           get confirmed before enforcement is switched on.
  -- enforce : off-network is accepted but parked as pending, so a changed ISP
  --           address inconveniences rather than strands people.
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

-- The whole security model depends on this grant list.
REVOKE ALL ON FUNCTION public.hr_record_punch(uuid, text, inet, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_record_punch(uuid, text, inet, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.hr_record_punch(uuid, text, inet, text, text, text) IS
  'service_role only. The IP is an argument, so any other caller could name its own -- the hr-attendance-punch edge function derives it from request headers.';

-- --- Today's state, including the server's network verdict -------------------

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

-- --- Admin review of an off-network punch -----------------------------------

CREATE OR REPLACE FUNCTION public.hr_review_punch(
  p_punch_id uuid, p_approve boolean, p_note text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_p record; v_me uuid;
BEGIN
  IF NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'You do not have permission to review attendance.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_p FROM hr_attendance_punches WHERE id = p_punch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Punch not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_p.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'This punch has already been reviewed.' USING ERRCODE = 'check_violation';
  END IF;

  v_me := nw_current_employee_id();

  UPDATE hr_attendance_punches
     SET approval_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         approved_by = v_me, approved_at = now(), review_note = COALESCE(p_note, '')
   WHERE id = p_punch_id;

  PERFORM hr_recompute_daily(v_p.employee_id, v_p.work_date);
  PERFORM hr_audit('attendance', p_punch_id,
    CASE WHEN p_approve THEN 'punch_approved' ELSE 'punch_rejected' END,
    jsonb_build_object('approval_status', 'pending'),
    jsonb_build_object('approval_status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END),
    COALESCE(p_note, ''));

  RETURN jsonb_build_object('ok', true, 'employee_id', v_p.employee_id, 'work_date', v_p.work_date);
END;
$$;

-- --- Admin review of an attendance correction -------------------------------

CREATE OR REPLACE FUNCTION public.hr_review_adjustment(
  p_adjustment_id uuid, p_approve boolean, p_note text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_a record; v_before jsonb;
BEGIN
  IF NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'You do not have permission to review attendance corrections.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_a FROM hr_attendance_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_a.status <> 'pending' THEN
    RAISE EXCEPTION 'This correction has already been reviewed.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM hr_attendance_daily
              WHERE employee_id = v_a.employee_id AND work_date = v_a.work_date AND locked) THEN
    RAISE EXCEPTION
      'Attendance for % is locked by a finalised payroll. Reopen that payroll first.', v_a.work_date
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Capture the day exactly as it stood, so the audit row shows what changed.
  SELECT to_jsonb(d) INTO v_before FROM hr_attendance_daily d
   WHERE d.employee_id = v_a.employee_id AND d.work_date = v_a.work_date;

  UPDATE hr_attendance_adjustments
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = nw_current_employee_id(), reviewed_at = now(),
         review_note = COALESCE(p_note, ''),
         before_value = COALESCE(v_before, '{}'::jsonb)
   WHERE id = p_adjustment_id;

  PERFORM hr_recompute_daily(v_a.employee_id, v_a.work_date);

  UPDATE hr_attendance_adjustments a
     SET after_value = COALESCE((SELECT to_jsonb(d) FROM hr_attendance_daily d
                                  WHERE d.employee_id = a.employee_id AND d.work_date = a.work_date),
                                '{}'::jsonb)
   WHERE a.id = p_adjustment_id;

  PERFORM hr_audit('attendance', p_adjustment_id,
    CASE WHEN p_approve THEN 'correction_approved' ELSE 'correction_rejected' END,
    COALESCE(v_before, '{}'::jsonb),
    COALESCE((SELECT to_jsonb(d) FROM hr_attendance_daily d
               WHERE d.employee_id = v_a.employee_id AND d.work_date = v_a.work_date), '{}'::jsonb),
    COALESCE(p_note, ''));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- --- Admin-triggered recomputation ------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_admin_recompute(
  p_employee_id uuid, p_from date, p_to date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'You do not have permission to recalculate attendance.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Recalculate at most one year at a time.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_employee_id IS NULL THEN
    RETURN (SELECT COALESCE(SUM(hr_recompute_range(e.id, p_from, p_to)), 0)
            FROM nw_employees e WHERE e.status = 'active');
  END IF;
  RETURN hr_recompute_range(p_employee_id, p_from, p_to);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_review_punch(uuid, boolean, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_review_adjustment(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_admin_recompute(uuid, date, date)      TO authenticated;
REVOKE ALL ON FUNCTION public.hr_review_punch(uuid, boolean, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_review_adjustment(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_admin_recompute(uuid, date, date)      FROM PUBLIC, anon;