-- =============================================================================
-- NIYOM HR & PAYROLL -- 11: leave counting, decisions and accrual
--
-- Approval is the moment a request becomes real: it expands into one
-- hr_leave_days row per working day, consumes balance, and recomputes the
-- attendance summary for every affected date. Cancelling reverses all three.
-- =============================================================================

-- How many days does this range actually cost? Weekly offs and holidays are
-- free, and a half-day at either end costs 0.5.
CREATE OR REPLACE FUNCTION public.hr_count_leave_days(
  p_employee_id uuid, p_from date, p_to date,
  p_from_half boolean DEFAULT false, p_to_half boolean DEFAULT false
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  d        date;
  v_total  numeric(6,2) := 0;
  v_sched  uuid;
  v_loc    text;
  v_part   numeric(3,2);
BEGIN
  SELECT work_schedule_id, COALESCE(holiday_location, 'Chennai')
    INTO v_sched, v_loc
  FROM hr_employee_profiles WHERE employee_id = p_employee_id;

  FOR d IN SELECT generate_series(p_from, p_to, interval '1 day')::date LOOP
    CONTINUE WHEN hr_is_weekly_off(v_sched, d);
    CONTINUE WHEN hr_is_holiday(v_loc, d) IS NOT NULL;

    v_part := 1.00;
    IF d = p_from AND p_from_half THEN v_part := 0.50; END IF;
    IF d = p_to   AND p_to_half   THEN v_part := 0.50; END IF;
    -- A single-day request flagged half at both ends is still half a day.
    IF p_from = p_to AND (p_from_half OR p_to_half) THEN v_part := 0.50; END IF;

    v_total := v_total + v_part;
  END LOOP;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_count_leave_days(uuid, date, date, boolean, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.hr_count_leave_days(uuid, date, date, boolean, boolean) FROM PUBLIC, anon;

-- --- Approve / reject --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_decide_leave(
  p_request_id uuid, p_approve boolean, p_note text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r          record;
  lt         record;
  v_me       uuid := nw_current_employee_id();
  d          date;
  v_sched    uuid;
  v_loc      text;
  v_part     numeric(3,2);
  v_days     numeric(6,2) := 0;
  v_year     smallint;
  v_clash    date;
BEGIN
  SELECT * INTO r FROM hr_leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (hr_can_edit('leave') OR hr_is_manager_of(r.employee_id)) THEN
    RAISE EXCEPTION 'You do not have permission to decide this leave request.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Approving your own leave defeats the purpose of approval, even for HR.
  IF r.employee_id = v_me AND NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'You cannot decide your own leave request.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This leave request has already been %.', r.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT p_approve THEN
    UPDATE hr_leave_requests
       SET status = 'rejected', approver_id = v_me, decided_at = now(),
           decision_note = COALESCE(p_note, '')
     WHERE id = p_request_id;
    PERFORM hr_audit('leave', p_request_id, 'leave_rejected', to_jsonb(r), '{}'::jsonb, COALESCE(p_note, ''));
    RETURN jsonb_build_object('ok', true, 'status', 'rejected');
  END IF;

  -- ---- Approve: materialise the days ------------------------------------
  SELECT * INTO lt FROM hr_leave_types WHERE id = r.leave_type_id;

  SELECT work_schedule_id, COALESCE(holiday_location, 'Chennai')
    INTO v_sched, v_loc
  FROM hr_employee_profiles WHERE employee_id = r.employee_id;

  -- Any day already booked would violate hr_leave_days_one_per_day. Say which
  -- day, rather than letting a unique-violation reach the user.
  SELECT ld.work_date INTO v_clash
  FROM hr_leave_days ld
  WHERE ld.employee_id = r.employee_id
    AND ld.work_date BETWEEN r.from_date AND r.to_date
  LIMIT 1;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Leave is already booked on %. Cancel that request first.', to_char(v_clash, 'DD Mon YYYY')
      USING ERRCODE = 'unique_violation';
  END IF;

  FOR d IN SELECT generate_series(r.from_date, r.to_date, interval '1 day')::date LOOP
    CONTINUE WHEN hr_is_weekly_off(v_sched, d);
    CONTINUE WHEN hr_is_holiday(v_loc, d) IS NOT NULL;

    v_part := 1.00;
    IF d = r.from_date AND r.from_half_day THEN v_part := 0.50; END IF;
    IF d = r.to_date   AND r.to_half_day   THEN v_part := 0.50; END IF;
    IF r.from_date = r.to_date AND (r.from_half_day OR r.to_half_day) THEN v_part := 0.50; END IF;

    INSERT INTO hr_leave_days (
      leave_request_id, employee_id, leave_type_id, work_date, portion, paid, counts_as_lop)
    VALUES (p_request_id, r.employee_id, r.leave_type_id, d, v_part,
            lt.paid, lt.counts_as_lop OR NOT lt.paid);

    v_days := v_days + v_part;
  END LOOP;

  IF v_days = 0 THEN
    RAISE EXCEPTION 'That range contains no working days.' USING ERRCODE = 'check_violation';
  END IF;

  -- ---- Consume balance ---------------------------------------------------
  IF lt.accrual_mode <> 'none' THEN
    v_year := EXTRACT(YEAR FROM r.from_date)::smallint;

    INSERT INTO hr_leave_balances (employee_id, leave_type_id, leave_year, used)
    VALUES (r.employee_id, r.leave_type_id, v_year, v_days)
    ON CONFLICT (employee_id, leave_type_id, leave_year)
    DO UPDATE SET used = hr_leave_balances.used + v_days;

    IF NOT lt.allow_negative THEN
      IF (SELECT balance FROM hr_leave_balances
           WHERE employee_id = r.employee_id AND leave_type_id = r.leave_type_id
             AND leave_year = v_year) < 0 THEN
        RAISE EXCEPTION
          'Not enough % balance for % day(s).', lt.name, v_days
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  UPDATE hr_leave_requests
     SET status = 'approved', approver_id = v_me, decided_at = now(),
         decision_note = COALESCE(p_note, ''), days = v_days
   WHERE id = p_request_id;

  PERFORM hr_recompute_range(r.employee_id, r.from_date, r.to_date);
  PERFORM hr_audit('leave', p_request_id, 'leave_approved', to_jsonb(r),
                   jsonb_build_object('days', v_days), COALESCE(p_note, ''));

  -- Tell the applicant.
  INSERT INTO nw_alerts (employee_id, title, message, category, action_url)
  VALUES (r.employee_id, 'Leave approved',
          lt.name || ' from ' || to_char(r.from_date, 'DD Mon') || ' to ' ||
          to_char(r.to_date, 'DD Mon YYYY') || ' has been approved.',
          'hr', '/crm/my_hr');

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'days', v_days);
END;
$$;

-- --- Cancel (applicant or HR) ------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_cancel_leave(p_request_id uuid, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r      record;
  lt     record;
  v_me   uuid := nw_current_employee_id();
  v_year smallint;
  v_days numeric(6,2);
BEGIN
  SELECT * INTO r FROM hr_leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (hr_can_edit('leave') OR r.employee_id = v_me) THEN
    RAISE EXCEPTION 'You do not have permission to cancel this leave request.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF r.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'This leave request is already %.', r.status USING ERRCODE = 'check_violation';
  END IF;

  -- Cancelling leave inside a finalised payroll period would change days that
  -- have already been paid.
  IF EXISTS (
    SELECT 1 FROM hr_attendance_daily
    WHERE employee_id = r.employee_id
      AND work_date BETWEEN r.from_date AND r.to_date AND locked
  ) THEN
    RAISE EXCEPTION
      'Part of this leave falls inside a finalised payroll and cannot be cancelled. Reopen that payroll first.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF r.status = 'approved' THEN
    SELECT * INTO lt FROM hr_leave_types WHERE id = r.leave_type_id;
    SELECT COALESCE(SUM(portion), 0) INTO v_days FROM hr_leave_days WHERE leave_request_id = p_request_id;

    DELETE FROM hr_leave_days WHERE leave_request_id = p_request_id;

    IF lt.accrual_mode <> 'none' AND v_days > 0 THEN
      v_year := EXTRACT(YEAR FROM r.from_date)::smallint;
      UPDATE hr_leave_balances
         SET used = GREATEST(0, used - v_days)
       WHERE employee_id = r.employee_id AND leave_type_id = r.leave_type_id AND leave_year = v_year;
    END IF;
  END IF;

  UPDATE hr_leave_requests
     SET status = 'cancelled', cancelled_at = now(), cancel_reason = COALESCE(p_reason, '')
   WHERE id = p_request_id;

  PERFORM hr_recompute_range(r.employee_id, r.from_date, r.to_date);
  PERFORM hr_audit('leave', p_request_id, 'leave_cancelled', to_jsonb(r), '{}'::jsonb, COALESCE(p_reason, ''));

  RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
END;
$$;

-- --- Monthly accrual ---------------------------------------------------------
-- Idempotent per (employee, type, month) via last_accrued_on, so a re-run or a
-- double-fired cron cannot credit twice.

CREATE OR REPLACE FUNCTION public.hr_accrue_leave(p_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_date  date := COALESCE(p_date, hr_today());
  v_month date := date_trunc('month', v_date)::date;
  v_year  smallint := EXTRACT(YEAR FROM v_date)::smallint;
  n       integer := 0;
  rec     record;
BEGIN
  FOR rec IN
    SELECT e.id AS employee_id, lt.id AS leave_type_id, lt.monthly_accrual, lt.max_balance
    FROM nw_employees e
    JOIN hr_employee_profiles pr ON pr.employee_id = e.id
    CROSS JOIN hr_leave_types lt
    WHERE e.status = 'active'
      AND pr.employment_status <> 'exited'
      AND lt.active
      AND lt.accrual_mode = 'monthly'
      AND lt.monthly_accrual > 0
      AND (e.joining_date IS NULL OR e.joining_date <= v_date)
  LOOP
    INSERT INTO hr_leave_balances (employee_id, leave_type_id, leave_year, accrued, last_accrued_on)
    VALUES (rec.employee_id, rec.leave_type_id, v_year, rec.monthly_accrual, v_month)
    ON CONFLICT (employee_id, leave_type_id, leave_year) DO UPDATE
      SET accrued = CASE
            WHEN hr_leave_balances.last_accrued_on IS DISTINCT FROM v_month
              THEN LEAST(
                     hr_leave_balances.accrued + rec.monthly_accrual,
                     COALESCE(rec.max_balance, hr_leave_balances.accrued + rec.monthly_accrual))
            ELSE hr_leave_balances.accrued
          END,
          last_accrued_on = v_month;
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_accrue_leave(date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hr_decide_leave(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_cancel_leave(uuid, text)          TO authenticated;
REVOKE ALL ON FUNCTION public.hr_decide_leave(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_cancel_leave(uuid, text)          FROM PUBLIC, anon;