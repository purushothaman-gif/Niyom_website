-- =============================================================================
-- NIYOM HR & PAYROLL -- 12: payroll lifecycle
--
-- The calculation engine runs in TypeScript (shared, unit-tested). This layer
-- does not trust its output: hr_payroll_write_records() re-derives every total
-- from the submitted lines and rejects the payload if the arithmetic does not
-- close. A tampered request therefore fails rather than quietly overpaying.
--
-- draft -> processing -> review -> approved -> locked -> paid
-- with reopen the only way back, and only with a reason.
-- =============================================================================

-- Render a payslip number from the configured token format.
CREATE OR REPLACE FUNCTION public.hr_payslip_number(
  p_format text, p_year smallint, p_month smallint, p_employee_code text, p_seq integer DEFAULT 1
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT replace(replace(replace(replace(replace(replace(
           COALESCE(NULLIF(p_format, ''), 'NIYOM/PAY/{YYYY}/{MM}/{EMPCODE}'),
           '{YYYY}',   p_year::text),
           '{YY}',     right(p_year::text, 2)),
           '{MM}',     lpad(p_month::text, 2, '0')),
           '{MMM}',   upper(to_char(make_date(p_year, p_month, 1), 'Mon'))),
           '{EMPCODE}', COALESCE(p_employee_code, '')),
           '{SEQ}',    lpad(p_seq::text, 4, '0'));
$$;

-- --- Open (or fetch) a run for a period --------------------------------------

CREATE OR REPLACE FUNCTION public.hr_payroll_open_run(
  p_year smallint, p_month smallint, p_pay_schedule_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sched  uuid := p_pay_schedule_id;
  v_start  date;
  v_end    date;
  v_id     uuid;
  v_mode   text;
BEGIN
  IF NOT hr_can_edit('payroll') THEN
    RAISE EXCEPTION 'You do not have permission to run payroll.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_sched IS NULL THEN
    SELECT id INTO v_sched FROM hr_pay_schedules WHERE is_default AND active LIMIT 1;
  END IF;

  SELECT lop_divisor_mode INTO v_mode FROM hr_pay_schedules WHERE id = v_sched;

  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + interval '1 month - 1 day')::date;

  SELECT id INTO v_id FROM hr_payroll_runs
   WHERE period_year = p_year AND period_month = p_month
     AND pay_schedule_id IS NOT DISTINCT FROM v_sched;

  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO hr_payroll_runs (
    period_year, period_month, pay_schedule_id, period_start, period_end,
    status, lop_divisor_mode, calendar_days, prepared_at, prepared_by)
  VALUES (
    p_year, p_month, v_sched, v_start, v_end,
    'draft', COALESCE(v_mode, 'calendar_days'), (v_end - v_start + 1),
    now(), nw_current_employee_id())
  RETURNING id INTO v_id;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name)
  SELECT v_id, 'opened', e.id, e.full_name
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payroll', v_id, 'run_opened', '{}'::jsonb,
                   jsonb_build_object('year', p_year, 'month', p_month));
  RETURN v_id;
END;
$$;

-- --- Write the computed run, verifying the arithmetic ------------------------

CREATE OR REPLACE FUNCTION public.hr_payroll_write_records(p_run_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  run          record;
  rec          jsonb;
  ln           jsonb;
  v_record_id  uuid;
  v_seen       uuid[] := ARRAY[]::uuid[];
  v_emp        uuid;

  v_sum_earn   numeric(14,2);
  v_sum_ded    numeric(14,2);
  v_sum_empr   numeric(14,2);
  v_net        numeric(14,2);

  v_count      integer := 0;
  v_t_gross    numeric(14,2) := 0;
  v_t_ded      numeric(14,2) := 0;
  v_t_empr     numeric(14,2) := 0;
  v_t_net      numeric(14,2) := 0;
  v_t_lop      numeric(8,2)  := 0;
  v_tol        numeric := 0.05;   -- rupee rounding slack across many lines
BEGIN
  IF NOT hr_can_edit('payroll') THEN
    RAISE EXCEPTION 'You do not have permission to run payroll.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF run.status NOT IN ('draft', 'processing', 'review') THEN
    RAISE EXCEPTION 'This payroll is % and can no longer be recalculated. Reopen it first.', run.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(p_payload -> 'records') <> 'array' THEN
    RAISE EXCEPTION 'Payroll payload is malformed.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Replace wholesale: a recalculation is a fresh answer, not a patch.
  DELETE FROM hr_payroll_employee_records WHERE run_id = p_run_id;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload -> 'records') LOOP
    v_emp := (rec ->> 'employee_id')::uuid;

    IF v_emp IS NULL THEN
      RAISE EXCEPTION 'A payroll row is missing its employee.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_emp = ANY (v_seen) THEN
      RAISE EXCEPTION 'Employee % appears twice in this payroll.', v_emp USING ERRCODE = 'unique_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM nw_employees WHERE id = v_emp) THEN
      RAISE EXCEPTION 'Unknown employee in payroll payload.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    v_seen := array_append(v_seen, v_emp);

    -- ---- Re-derive the totals from the lines themselves ------------------
    SELECT
      COALESCE(SUM(CASE WHEN l ->> 'kind' = 'earning'               THEN (l ->> 'amount')::numeric END), 0),
      COALESCE(SUM(CASE WHEN l ->> 'kind' = 'deduction'             THEN (l ->> 'amount')::numeric END), 0),
      COALESCE(SUM(CASE WHEN l ->> 'kind' = 'employer_contribution' THEN (l ->> 'amount')::numeric END), 0)
      INTO v_sum_earn, v_sum_ded, v_sum_empr
    FROM jsonb_array_elements(COALESCE(rec -> 'lines', '[]'::jsonb)) AS l;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(rec -> 'lines', '[]'::jsonb)) AS l
      WHERE (l ->> 'amount')::numeric < 0
    ) THEN
      RAISE EXCEPTION 'Payroll contains a negative component amount for employee %.', v_emp
        USING ERRCODE = 'check_violation';
    END IF;

    IF abs(v_sum_earn - COALESCE((rec ->> 'gross_earnings')::numeric, 0)) > v_tol THEN
      RAISE EXCEPTION
        'Payroll rejected: gross earnings (%) do not match the sum of earning lines (%) for employee %.',
        (rec ->> 'gross_earnings'), v_sum_earn, v_emp USING ERRCODE = 'check_violation';
    END IF;

    IF abs(v_sum_ded - COALESCE((rec ->> 'total_deductions')::numeric, 0)) > v_tol THEN
      RAISE EXCEPTION
        'Payroll rejected: total deductions (%) do not match the sum of deduction lines (%) for employee %.',
        (rec ->> 'total_deductions'), v_sum_ded, v_emp USING ERRCODE = 'check_violation';
    END IF;

    IF abs(v_sum_empr - COALESCE((rec ->> 'employer_contrib')::numeric, 0)) > v_tol THEN
      RAISE EXCEPTION
        'Payroll rejected: employer contributions do not match their lines for employee %.', v_emp
        USING ERRCODE = 'check_violation';
    END IF;

    v_net := COALESCE((rec ->> 'net_pay')::numeric, 0);
    -- Net is gross minus deductions. Employer contributions are a company cost
    -- and must never move take-home; allow at most a rupee of rounding.
    IF abs((v_sum_earn - v_sum_ded) - v_net) > 1.00 THEN
      RAISE EXCEPTION
        'Payroll rejected: net pay (%) is not gross (%) minus deductions (%) for employee %.',
        v_net, v_sum_earn, v_sum_ded, v_emp USING ERRCODE = 'check_violation';
    END IF;

    IF v_net < 0 THEN
      RAISE EXCEPTION 'Payroll rejected: net pay is negative for employee %. Review the deductions.', v_emp
        USING ERRCODE = 'check_violation';
    END IF;

    -- ---- Insert the snapshot ---------------------------------------------
    INSERT INTO hr_payroll_employee_records (
      run_id, employee_id, structure_id,
      employee_code, full_name, designation, department, joining_date, pan, uan,
      bank_name, bank_account, bank_ifsc, account_holder,
      calendar_days, working_days, present_days, paid_leave_days, unpaid_leave_days,
      holiday_days, weekly_off_days, absent_days, lop_days, payable_days, lop_divisor,
      late_days, early_out_days, overtime_minutes,
      ctc_annual, gross_earnings, total_deductions, employer_contrib, lop_amount, net_pay,
      status, exclusion_reason, exceptions)
    VALUES (
      p_run_id, v_emp, NULLIF(rec ->> 'structure_id', '')::uuid,
      COALESCE(rec ->> 'employee_code', ''), COALESCE(rec ->> 'full_name', ''),
      COALESCE(rec ->> 'designation', ''),   COALESCE(rec ->> 'department', ''),
      NULLIF(rec ->> 'joining_date', '')::date, NULLIF(rec ->> 'pan', ''), NULLIF(rec ->> 'uan', ''),
      COALESCE(rec ->> 'bank_name', ''),    COALESCE(rec ->> 'bank_account', ''),
      COALESCE(rec ->> 'bank_ifsc', ''),    COALESCE(rec ->> 'account_holder', ''),
      COALESCE((rec ->> 'calendar_days')::smallint, 0),
      COALESCE((rec ->> 'working_days')::numeric, 0),
      COALESCE((rec ->> 'present_days')::numeric, 0),
      COALESCE((rec ->> 'paid_leave_days')::numeric, 0),
      COALESCE((rec ->> 'unpaid_leave_days')::numeric, 0),
      COALESCE((rec ->> 'holiday_days')::numeric, 0),
      COALESCE((rec ->> 'weekly_off_days')::numeric, 0),
      COALESCE((rec ->> 'absent_days')::numeric, 0),
      COALESCE((rec ->> 'lop_days')::numeric, 0),
      COALESCE((rec ->> 'payable_days')::numeric, 0),
      COALESCE((rec ->> 'lop_divisor')::numeric, 30),
      COALESCE((rec ->> 'late_days')::smallint, 0),
      COALESCE((rec ->> 'early_out_days')::smallint, 0),
      COALESCE((rec ->> 'overtime_minutes')::integer, 0),
      COALESCE((rec ->> 'ctc_annual')::numeric, 0),
      v_sum_earn, v_sum_ded, v_sum_empr,
      COALESCE((rec ->> 'lop_amount')::numeric, 0), v_net,
      COALESCE(rec ->> 'status', 'included'),
      COALESCE(rec ->> 'exclusion_reason', ''),
      COALESCE(rec -> 'exceptions', '[]'::jsonb))
    RETURNING id INTO v_record_id;

    FOR ln IN SELECT * FROM jsonb_array_elements(COALESCE(rec -> 'lines', '[]'::jsonb)) LOOP
      INSERT INTO hr_payroll_lines (
        record_id, component_id, component_code, component_name, kind,
        base_amount, amount, prorated, taxable, show_on_payslip, adjustment_id, sort_order)
      VALUES (
        v_record_id, NULLIF(ln ->> 'component_id', '')::uuid,
        COALESCE(ln ->> 'component_code', ''), COALESCE(ln ->> 'component_name', ''),
        ln ->> 'kind',
        COALESCE((ln ->> 'base_amount')::numeric, 0),
        COALESCE((ln ->> 'amount')::numeric, 0),
        COALESCE((ln ->> 'prorated')::boolean, false),
        COALESCE((ln ->> 'taxable')::boolean, true),
        COALESCE((ln ->> 'show_on_payslip')::boolean, true),
        NULLIF(ln ->> 'adjustment_id', '')::uuid,
        COALESCE((ln ->> 'sort_order')::smallint, 0));
    END LOOP;

    IF COALESCE(rec ->> 'status', 'included') = 'included' THEN
      v_count   := v_count + 1;
      v_t_gross := v_t_gross + v_sum_earn;
      v_t_ded   := v_t_ded   + v_sum_ded;
      v_t_empr  := v_t_empr  + v_sum_empr;
      v_t_net   := v_t_net   + v_net;
      v_t_lop   := v_t_lop   + COALESCE((rec ->> 'lop_days')::numeric, 0);
    END IF;
  END LOOP;

  UPDATE hr_payroll_runs
     SET employee_count = v_count, total_gross = v_t_gross, total_deductions = v_t_ded,
         total_employer = v_t_empr, total_net = v_t_net, total_lop_days = v_t_lop,
         status = 'review', calculated_at = now()
   WHERE id = p_run_id;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, after_value)
  SELECT p_run_id,
         CASE WHEN run.calculated_at IS NULL THEN 'calculated' ELSE 'recalculated' END,
         e.id, e.full_name,
         jsonb_build_object('employees', v_count, 'gross', v_t_gross, 'net', v_t_net)
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payroll', p_run_id, 'run_calculated', '{}'::jsonb,
                   jsonb_build_object('employees', v_count, 'gross', v_t_gross, 'net', v_t_net));

  RETURN jsonb_build_object('ok', true, 'employees', v_count,
                            'gross', v_t_gross, 'deductions', v_t_ded,
                            'employer', v_t_empr, 'net', v_t_net);
END;
$$;

-- --- State transitions -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_payroll_approve(p_run_id uuid, p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE run record;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can approve payroll.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF run.status <> 'review' THEN
    RAISE EXCEPTION 'Only a payroll under review can be approved (this one is %).', run.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF run.employee_count = 0 THEN
    RAISE EXCEPTION 'This payroll has no employees to approve.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('hr.transition_ok', 'yes', true);
  UPDATE hr_payroll_runs
     SET status = 'approved', approved_at = now(), approved_by = nw_current_employee_id()
   WHERE id = p_run_id;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, reason)
  SELECT p_run_id, 'approved', e.id, e.full_name, COALESCE(p_note, '')
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payroll', p_run_id, 'run_approved',
                   jsonb_build_object('status', 'review'),
                   jsonb_build_object('status', 'approved'), COALESCE(p_note, ''));
  RETURN jsonb_build_object('ok', true, 'status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_payroll_lock(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE run record; v_days integer;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can lock payroll.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF run.status <> 'approved' THEN
    RAISE EXCEPTION 'Approve the payroll before locking it (this one is %).', run.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Freeze the attendance that produced these figures. hr_recompute_daily()
  -- refuses to touch a locked day, so the register can no longer drift away
  -- from the payslips that were issued from it.
  UPDATE hr_attendance_daily d
     SET locked = true, locked_by_run_id = p_run_id
   WHERE d.work_date BETWEEN run.period_start AND run.period_end
     AND d.employee_id IN (SELECT employee_id FROM hr_payroll_employee_records WHERE run_id = p_run_id);
  GET DIAGNOSTICS v_days = ROW_COUNT;

  PERFORM set_config('hr.transition_ok', 'yes', true);
  UPDATE hr_payroll_runs
     SET status = 'locked', locked_at = now(), locked_by = nw_current_employee_id()
   WHERE id = p_run_id;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, after_value)
  SELECT p_run_id, 'locked', e.id, e.full_name, jsonb_build_object('attendance_days_locked', v_days)
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payroll', p_run_id, 'run_locked',
                   jsonb_build_object('status', 'approved'),
                   jsonb_build_object('status', 'locked', 'attendance_days_locked', v_days));
  RETURN jsonb_build_object('ok', true, 'status', 'locked', 'attendance_days_locked', v_days);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_payroll_reopen(p_run_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE run record;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can reopen payroll.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to reopen a finalised payroll.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF run.status NOT IN ('approved', 'locked', 'paid') THEN
    RAISE EXCEPTION 'Only a finalised payroll can be reopened (this one is %).', run.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Withdraw the payslips: figures that are about to change must not stay
  -- downloadable, and the employee-side RLS keys off `published`.
  UPDATE hr_payslips SET published = false WHERE run_id = p_run_id;

  UPDATE hr_attendance_daily
     SET locked = false, locked_by_run_id = NULL
   WHERE locked_by_run_id = p_run_id;

  PERFORM set_config('hr.transition_ok', 'yes', true);
  UPDATE hr_payroll_runs
     SET status = 'processing', reopen_count = reopen_count + 1,
         approved_at = NULL, approved_by = NULL, locked_at = NULL, locked_by = NULL,
         paid_at = NULL, paid_by = NULL
   WHERE id = p_run_id;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, reason, before_value, after_value)
  SELECT p_run_id, 'reopened', e.id, e.full_name, p_reason,
         jsonb_build_object('status', run.status, 'net', run.total_net),
         jsonb_build_object('status', 'processing')
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payroll', p_run_id, 'run_reopened',
                   jsonb_build_object('status', run.status, 'total_net', run.total_net),
                   jsonb_build_object('status', 'processing'), p_reason);
  RETURN jsonb_build_object('ok', true, 'status', 'processing');
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_payroll_mark_paid(p_run_id uuid, p_payment_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE run record;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can mark payroll as paid.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF run.status <> 'locked' THEN
    RAISE EXCEPTION 'Lock the payroll before marking it paid (this one is %).', run.status
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('hr.transition_ok', 'yes', true);
  UPDATE hr_payroll_runs
     SET status = 'paid', paid_at = now(), paid_by = nw_current_employee_id(),
         payment_date = COALESCE(p_payment_date, hr_today())
   WHERE id = p_run_id;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name)
  SELECT p_run_id, 'marked_paid', e.id, e.full_name
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payroll', p_run_id, 'run_marked_paid',
                   jsonb_build_object('status', 'locked'), jsonb_build_object('status', 'paid'));
  RETURN jsonb_build_object('ok', true, 'status', 'paid');
END;
$$;

-- --- Publish payslips --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_publish_payslips(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  run    record;
  fmt    text;
  r      record;
  v_n    integer := 0;
BEGIN
  IF NOT hr_can_edit('payslips') THEN
    RAISE EXCEPTION 'You do not have permission to publish payslips.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF run.status NOT IN ('locked', 'paid') THEN
    RAISE EXCEPTION 'Lock the payroll before publishing payslips (this one is %).', run.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT payslip_number_format INTO fmt FROM hr_settings WHERE id = 1;

  FOR r IN
    SELECT * FROM hr_payroll_employee_records
     WHERE run_id = p_run_id AND status = 'included'
  LOOP
    INSERT INTO hr_payslips (
      run_id, record_id, employee_id, payslip_number, period_year, period_month,
      net_pay, published, published_at, generated_by)
    VALUES (
      p_run_id, r.id, r.employee_id,
      hr_payslip_number(fmt, run.period_year, run.period_month, r.employee_code, 1),
      run.period_year, run.period_month, r.net_pay, true, now(), nw_current_employee_id())
    ON CONFLICT (run_id, employee_id) DO UPDATE
      SET published = true, published_at = now(), net_pay = EXCLUDED.net_pay;

    INSERT INTO nw_alerts (employee_id, title, message, category, action_url)
    VALUES (r.employee_id, 'Payslip available',
            'Your payslip for ' || to_char(make_date(run.period_year, run.period_month, 1), 'Month YYYY')
              || ' is ready to download.',
            'hr', '/crm/my_hr');

    v_n := v_n + 1;
  END LOOP;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, after_value)
  SELECT p_run_id, 'payslips_published', e.id, e.full_name, jsonb_build_object('count', v_n)
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payslip', p_run_id, 'payslips_published', '{}'::jsonb,
                   jsonb_build_object('count', v_n));

  RETURN jsonb_build_object('ok', true, 'published', v_n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_payroll_open_run(smallint, smallint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payroll_write_records(uuid, jsonb)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payroll_approve(uuid, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payroll_lock(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payroll_reopen(uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payroll_mark_paid(uuid, date)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_publish_payslips(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payslip_number(text, smallint, smallint, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.hr_payroll_open_run(smallint, smallint, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_payroll_write_records(uuid, jsonb)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_payroll_approve(uuid, text)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_payroll_lock(uuid)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_payroll_reopen(uuid, text)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_payroll_mark_paid(uuid, date)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_publish_payslips(uuid)                     FROM PUBLIC, anon;