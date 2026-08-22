-- =============================================================================
-- Fix: calculating a freshly-opened payroll run failed with
--   "Payroll cannot move from draft to review here."
--
-- hr_payroll_open_run() creates a run as `draft`; hr_payroll_write_records()
-- moves it to `review` once the figures are in. But hr_guard_run_transition()
-- only permitted draft -> processing, so the single most ordinary action in the
-- whole module -- open this month's payroll and press Calculate -- was refused.
--
-- WHY THE TESTS MISSED IT: every test that exercised write_records built its
-- run with status 'processing' or 'review' already set, because that was
-- convenient for the case being tested. The one transition a real user hits
-- first was the one no fixture ever produced. Found by loading real historical
-- payroll, not by testing.
--
-- The fix is the mechanism already used by approve, lock, reopen and mark-paid:
-- an authorised SECURITY DEFINER function that has validated the move sets
-- `hr.transition_ok` for the statement. The guard keeps refusing hand-written
-- UPDATEs, which is what it is for -- it was never meant to police the RPCs
-- that implement the workflow.
-- =============================================================================

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
  v_tol        numeric := 0.05;
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
    IF abs((v_sum_earn - v_sum_ded) - v_net) > 1.00 THEN
      RAISE EXCEPTION
        'Payroll rejected: net pay (%) is not gross (%) minus deductions (%) for employee %.',
        v_net, v_sum_earn, v_sum_ded, v_emp USING ERRCODE = 'check_violation';
    END IF;

    IF v_net < 0 THEN
      RAISE EXCEPTION 'Payroll rejected: net pay is negative for employee %. Review the deductions.', v_emp
        USING ERRCODE = 'check_violation';
    END IF;

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

  -- draft -> review is a legitimate move made by an authorised function that
  -- has just validated the whole payload. The guard exists to refuse
  -- hand-written UPDATEs, not the RPCs that implement the workflow.
  PERFORM set_config('hr.transition_ok', 'yes', true);

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

REVOKE ALL ON FUNCTION public.hr_payroll_write_records(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_payroll_write_records(uuid, jsonb) TO authenticated;