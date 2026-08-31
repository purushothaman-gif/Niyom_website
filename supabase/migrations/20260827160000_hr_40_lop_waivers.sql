-- =============================================================================
-- Let an administrator forgive loss-of-pay days, per employee, per run.
--
-- WHY A TABLE AND NOT A NUMBER ON THE RECORD. The payroll record is rewritten
-- from scratch on every recalculation -- that is the point of recalculating --
-- so a waiver stored there would be erased by the next Calculate, which is
-- exactly the moment it needs to survive. The waiver is an INPUT to the
-- calculation, so it lives beside the run, not inside its output.
--
-- WHAT IT CANNOT DO. A waiver forgives loss of pay; it cannot manufacture
-- attendance. It is capped at the LOP actually incurred, and lop_days already
-- excludes the days before a joiner started and after a leaver finished. So
-- waiving "30 days" for someone who joined on the 20th forgives their real
-- absence and nothing else -- it can never pay them for days they were not
-- employed. The cap is applied in the engine as well as here, because the
-- attendance behind a waiver can change after it is entered.
--
-- SCOPE. Tied to the run, so it cannot leak into another month, and cascaded
-- on delete. Blocked once the run is approved, locked or paid -- the same gate
-- hr_payroll_write_records uses, so a waiver can never move settled money.
-- =============================================================================

CREATE TABLE public.hr_payroll_lop_waivers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,

  -- Days of loss of pay to forgive. Half days are real, hence the scale.
  days        numeric(6,2) NOT NULL CHECK (days > 0 AND days <= 366),
  -- Not optional. A waiver moves money; "why" is the whole audit trail.
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 3),

  created_by  uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- One waiver per employee per run: two rows would silently stack.
  UNIQUE (run_id, employee_id)
);

CREATE INDEX hr_payroll_lop_waivers_run_idx ON public.hr_payroll_lop_waivers (run_id);

CREATE TRIGGER hr_payroll_lop_waivers_touch BEFORE UPDATE ON public.hr_payroll_lop_waivers
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

COMMENT ON TABLE public.hr_payroll_lop_waivers IS
  'Administrator-granted forgiveness of loss-of-pay days, per employee per payroll run. An INPUT to the calculation, which is why it does not live on the payroll record that Calculate overwrites. Capped at the LOP actually incurred.';

ALTER TABLE public.hr_payroll_lop_waivers ENABLE ROW LEVEL SECURITY;

-- Salary-grade information: who was forgiven what, and why. Payroll viewers
-- only -- an employee must not be able to read the list, and must never be
-- able to write one.
CREATE POLICY hr_payroll_lop_waivers_read ON public.hr_payroll_lop_waivers
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('payroll')));

CREATE POLICY hr_payroll_lop_waivers_write ON public.hr_payroll_lop_waivers
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));

-- Record the grant and the removal in the run's own event log.
ALTER TABLE public.hr_payroll_events DROP CONSTRAINT IF EXISTS hr_payroll_events_event_check;
ALTER TABLE public.hr_payroll_events ADD CONSTRAINT hr_payroll_events_event_check
  CHECK (event IN ('opened', 'calculated', 'recalculated', 'approved', 'locked',
                   'reopened', 'marked_paid', 'payslips_published',
                   'bank_file_generated', 'cancelled',
                   'lop_waived', 'lop_waiver_removed'));


-- --- Guard shared by every waiver RPC ---------------------------------------

CREATE OR REPLACE FUNCTION public.hr_payroll_waiver_guard(p_run_id uuid)
RETURNS public.hr_payroll_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE run public.hr_payroll_runs;
BEGIN
  IF NOT hr_can_edit('payroll') THEN
    RAISE EXCEPTION 'You do not have permission to change payroll.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found';
  END IF;

  -- The same gate hr_payroll_write_records uses. Anything past review is
  -- settled money; changing an input to a figure already approved would leave
  -- the payslip and the bank file disagreeing with the record.
  IF run.status NOT IN ('draft', 'processing', 'review') THEN
    RAISE EXCEPTION
      'This payroll is % and its loss of pay can no longer be changed. Reopen it first.', run.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN run;
END;
$$;


-- --- Grant or update one waiver ---------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_payroll_waive_lop(
  p_run_id uuid, p_employee_id uuid, p_days numeric, p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  run     public.hr_payroll_runs;
  v_id    uuid;
  v_prev  numeric;
  v_name  text;
BEGIN
  run := hr_payroll_waiver_guard(p_run_id);

  IF p_days IS NULL OR p_days <= 0 THEN
    RAISE EXCEPTION 'Enter how many days of loss of pay to waive.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Give a reason for waiving the loss of pay.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT full_name INTO v_name FROM nw_employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT days INTO v_prev FROM hr_payroll_lop_waivers
   WHERE run_id = p_run_id AND employee_id = p_employee_id;

  INSERT INTO hr_payroll_lop_waivers (run_id, employee_id, days, reason, created_by)
  VALUES (p_run_id, p_employee_id, round(p_days, 2), btrim(p_reason), nw_current_employee_id())
  ON CONFLICT (run_id, employee_id) DO UPDATE
    SET days = EXCLUDED.days, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by
  RETURNING id INTO v_id;

  INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, reason,
                                 before_value, after_value)
  SELECT p_run_id, 'lop_waived', e.id, e.full_name, btrim(p_reason),
         jsonb_build_object('employee', v_name, 'days', v_prev),
         jsonb_build_object('employee', v_name, 'days', round(p_days, 2))
  FROM nw_employees e WHERE e.auth_user_id = auth.uid();

  PERFORM hr_audit('payroll', p_run_id, 'lop_waived',
                   jsonb_build_object('days', v_prev),
                   jsonb_build_object('employee_id', p_employee_id, 'days', round(p_days, 2),
                                      'reason', btrim(p_reason)));
  RETURN v_id;
END;
$$;


-- --- Remove one waiver, or every waiver on the run --------------------------
-- p_employee_id NULL clears them all. One function rather than two because the
-- guard, the event and the audit entry are identical and would drift apart.

CREATE OR REPLACE FUNCTION public.hr_payroll_clear_lop_waiver(
  p_run_id uuid, p_employee_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_removed integer := 0;
  v_detail  jsonb;
BEGIN
  PERFORM hr_payroll_waiver_guard(p_run_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('employee', e.full_name, 'days', w.days)), '[]'::jsonb)
    INTO v_detail
  FROM hr_payroll_lop_waivers w
  JOIN nw_employees e ON e.id = w.employee_id
  WHERE w.run_id = p_run_id
    AND (p_employee_id IS NULL OR w.employee_id = p_employee_id);

  DELETE FROM hr_payroll_lop_waivers
   WHERE run_id = p_run_id
     AND (p_employee_id IS NULL OR employee_id = p_employee_id);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  IF v_removed > 0 THEN
    INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, before_value)
    SELECT p_run_id, 'lop_waiver_removed', e.id, e.full_name, v_detail
    FROM nw_employees e WHERE e.auth_user_id = auth.uid();

    PERFORM hr_audit('payroll', p_run_id, 'lop_waiver_removed', v_detail,
                     jsonb_build_object('removed', v_removed));
  END IF;

  RETURN v_removed;
END;
$$;


REVOKE ALL ON FUNCTION public.hr_payroll_waiver_guard(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_payroll_waive_lop(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_payroll_clear_lop_waiver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_payroll_waive_lop(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payroll_clear_lop_waiver(uuid, uuid) TO authenticated;
