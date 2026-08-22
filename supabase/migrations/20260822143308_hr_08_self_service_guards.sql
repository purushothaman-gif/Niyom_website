-- =============================================================================
-- NIYOM HR & PAYROLL -- 08: column and state-transition guards
--
-- RLS decides WHICH ROWS a user may touch; it cannot decide WHICH COLUMNS. Every
-- place where an employee is allowed to update their own row therefore needs a
-- trigger to say what "their own row" actually permits -- the same lesson as the
-- nw_employees escalation this module opened with.
-- =============================================================================

-- --- Employee self-service on their HR profile -------------------------------

CREATE OR REPLACE FUNCTION public.hr_guard_profile_self_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_me      uuid;
  v_blocked text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;            -- service role / definer
  IF hr_can_edit('employees') THEN RETURN NEW; END IF; -- HR may change anything

  v_me := nw_current_employee_id();
  IF OLD.employee_id IS DISTINCT FROM v_me THEN
    RETURN NEW;  -- not their row; RLS already decided
  END IF;

  -- Allowlist: contact details only. Everything that affects pay, leave,
  -- authority or attendance is HR-owned.
  IF NEW.employee_id          IS DISTINCT FROM OLD.employee_id          THEN v_blocked := array_append(v_blocked, 'employee'); END IF;
  IF NEW.department           IS DISTINCT FROM OLD.department           THEN v_blocked := array_append(v_blocked, 'department'); END IF;
  IF NEW.employment_type      IS DISTINCT FROM OLD.employment_type      THEN v_blocked := array_append(v_blocked, 'employment type'); END IF;
  IF NEW.work_location        IS DISTINCT FROM OLD.work_location        THEN v_blocked := array_append(v_blocked, 'work location'); END IF;
  IF NEW.reporting_manager_id IS DISTINCT FROM OLD.reporting_manager_id THEN v_blocked := array_append(v_blocked, 'reporting manager'); END IF;
  IF NEW.probation_months     IS DISTINCT FROM OLD.probation_months     THEN v_blocked := array_append(v_blocked, 'probation'); END IF;
  IF NEW.confirmation_date    IS DISTINCT FROM OLD.confirmation_date    THEN v_blocked := array_append(v_blocked, 'confirmation date'); END IF;
  IF NEW.exit_date            IS DISTINCT FROM OLD.exit_date            THEN v_blocked := array_append(v_blocked, 'exit date'); END IF;
  IF NEW.exit_reason          IS DISTINCT FROM OLD.exit_reason          THEN v_blocked := array_append(v_blocked, 'exit reason'); END IF;
  IF NEW.employment_status    IS DISTINCT FROM OLD.employment_status    THEN v_blocked := array_append(v_blocked, 'employment status'); END IF;
  IF NEW.date_of_birth        IS DISTINCT FROM OLD.date_of_birth        THEN v_blocked := array_append(v_blocked, 'date of birth'); END IF;
  IF NEW.pan                  IS DISTINCT FROM OLD.pan                  THEN v_blocked := array_append(v_blocked, 'PAN'); END IF;
  IF NEW.uan                  IS DISTINCT FROM OLD.uan                  THEN v_blocked := array_append(v_blocked, 'UAN'); END IF;
  IF NEW.pf_number            IS DISTINCT FROM OLD.pf_number            THEN v_blocked := array_append(v_blocked, 'PF number'); END IF;
  IF NEW.esi_number           IS DISTINCT FROM OLD.esi_number           THEN v_blocked := array_append(v_blocked, 'ESI number'); END IF;
  IF NEW.pf_applicable        IS DISTINCT FROM OLD.pf_applicable        THEN v_blocked := array_append(v_blocked, 'PF applicability'); END IF;
  IF NEW.esi_applicable       IS DISTINCT FROM OLD.esi_applicable       THEN v_blocked := array_append(v_blocked, 'ESI applicability'); END IF;
  IF NEW.pt_applicable        IS DISTINCT FROM OLD.pt_applicable        THEN v_blocked := array_append(v_blocked, 'PT applicability'); END IF;
  IF NEW.hr_role              IS DISTINCT FROM OLD.hr_role              THEN v_blocked := array_append(v_blocked, 'HR role'); END IF;
  IF NEW.work_schedule_id     IS DISTINCT FROM OLD.work_schedule_id     THEN v_blocked := array_append(v_blocked, 'work schedule'); END IF;
  IF NEW.pay_schedule_id      IS DISTINCT FROM OLD.pay_schedule_id      THEN v_blocked := array_append(v_blocked, 'pay schedule'); END IF;
  IF NEW.network_exempt       IS DISTINCT FROM OLD.network_exempt       THEN v_blocked := array_append(v_blocked, 'network exemption'); END IF;
  IF NEW.holiday_location     IS DISTINCT FROM OLD.holiday_location     THEN v_blocked := array_append(v_blocked, 'holiday location'); END IF;
  IF NEW.notes                IS DISTINCT FROM OLD.notes                THEN v_blocked := array_append(v_blocked, 'HR notes'); END IF;

  IF array_length(v_blocked, 1) > 0 THEN
    RAISE EXCEPTION 'Not permitted: % can only be changed by HR.',
      array_to_string(v_blocked, ', ') USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_profiles_self_guard BEFORE UPDATE ON public.hr_employee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_profile_self_update();

-- --- Leave requests: an employee may withdraw, never decide ------------------

CREATE OR REPLACE FUNCTION public.hr_guard_leave_request_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR hr_can_edit('leave') THEN
    RETURN NEW;
  END IF;

  -- A reporting manager may decide their own team's leave.
  IF hr_is_manager_of(OLD.employee_id)
     AND NEW.employee_id = OLD.employee_id
     AND OLD.status = 'pending' THEN
    RETURN NEW;
  END IF;

  IF OLD.employee_id IS DISTINCT FROM nw_current_employee_id() THEN
    RETURN NEW;  -- not their row; RLS already decided
  END IF;

  -- Own request. Approving yourself is the whole point of this guard.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'You cannot approve or reject your own leave request.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status IN ('rejected', 'cancelled') THEN
    RAISE EXCEPTION 'This leave request is closed and can no longer be changed.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Editing the dates of an already-approved request would silently invalidate
  -- the expanded hr_leave_days rows.
  IF OLD.status = 'approved'
     AND (NEW.from_date IS DISTINCT FROM OLD.from_date
       OR NEW.to_date   IS DISTINCT FROM OLD.to_date
       OR NEW.days      IS DISTINCT FROM OLD.days
       OR NEW.leave_type_id IS DISTINCT FROM OLD.leave_type_id) THEN
    RAISE EXCEPTION 'An approved leave request cannot be edited. Cancel it and apply again.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.approver_id IS DISTINCT FROM OLD.approver_id
  OR NEW.decided_at  IS DISTINCT FROM OLD.decided_at
  OR NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN
    RAISE EXCEPTION 'Approval details are set by the approver, not the applicant.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_leave_requests_guard BEFORE UPDATE ON public.hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_leave_request_update();

-- --- Attendance corrections: same shape ---------------------------------------

CREATE OR REPLACE FUNCTION public.hr_guard_adjustment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR hr_can_edit('attendance') THEN
    RETURN NEW;
  END IF;

  IF OLD.employee_id IS DISTINCT FROM nw_current_employee_id() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'You cannot approve your own attendance correction.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
  OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
  OR NEW.review_note IS DISTINCT FROM OLD.review_note
  OR NEW.kind = 'admin_override' THEN
    RAISE EXCEPTION 'Review details are set by the approver, not the requester.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_adjustments_guard BEFORE UPDATE ON public.hr_attendance_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_adjustment_update();

-- --- Payroll: a locked run is closed to ordinary writes -----------------------

CREATE OR REPLACE FUNCTION public.hr_guard_run_locked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM hr_payroll_runs
  WHERE id = COALESCE(NEW.run_id, OLD.run_id);

  IF v_status IN ('approved', 'locked', 'paid') THEN
    RAISE EXCEPTION
      'This payroll is % and cannot be modified. Reopen it with a reason first.', v_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER hr_payroll_records_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.hr_payroll_employee_records
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_run_locked();

CREATE TRIGGER hr_payroll_adjustments_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.hr_payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_run_locked();

-- Payroll lines hang off a record, so the run has to be looked up one hop away.
CREATE OR REPLACE FUNCTION public.hr_guard_line_locked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status text;
BEGIN
  SELECT r.status INTO v_status
  FROM hr_payroll_employee_records rec
  JOIN hr_payroll_runs r ON r.id = rec.run_id
  WHERE rec.id = COALESCE(NEW.record_id, OLD.record_id);

  IF v_status IN ('approved', 'locked', 'paid') THEN
    RAISE EXCEPTION
      'This payroll is % and its figures cannot be modified. Reopen it with a reason first.', v_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER hr_payroll_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.hr_payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_line_locked();

-- A run may only move along the intended path, and only ever backwards through
-- an explicit reopen (which hr_payroll_reopen() performs as the service role).
CREATE OR REPLACE FUNCTION public.hr_guard_run_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Reached only through the RPCs, which run as SECURITY DEFINER with the
  -- transition already validated and audited.
  IF current_setting('hr.transition_ok', true) = 'yes' THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.status
    WHEN 'draft'      THEN ARRAY['processing', 'cancelled']
    WHEN 'processing' THEN ARRAY['review', 'draft', 'cancelled']
    WHEN 'review'     THEN ARRAY['processing', 'cancelled']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.status = ANY (v_allowed)) THEN
    RAISE EXCEPTION
      'Payroll cannot move from % to % here. Use the Approve, Lock, Reopen or Mark Paid action.',
      OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_payroll_runs_transition BEFORE UPDATE ON public.hr_payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_run_transition();