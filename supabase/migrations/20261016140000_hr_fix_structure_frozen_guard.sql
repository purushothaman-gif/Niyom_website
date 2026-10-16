-- Salary revisions were impossible for anyone whose current structure had been
-- used by a payroll run.
--
-- 1. hr_guard_structure_frozen() read OLD.structure_id, a column that does not
--    exist on hr_salary_structures. PL/pgSQL resolves record fields at run time,
--    so EVERY update/delete of a structure failed with 42703 -- including the
--    automatic close-out that hr_guard_structure_dates() performs when a new
--    revision is inserted. The UI showed only "Something went wrong".
--
-- 2. Even with that fixed, the guard refused ALL changes to a structure used by
--    a locked run, which also blocked that close-out. Ending a structure after
--    the last locked period it paid does not alter any historical payslip, so
--    that one narrow change is now allowed: effective_to set to a date on/after
--    the end of every approved/locked/paid period using it, status -> superseded,
--    nothing else touched. Amounts, dates in the past and deletion stay frozen.

CREATE OR REPLACE FUNCTION public.hr_guard_structure_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_run      text;
  v_last_end date;
BEGIN
  SELECT r.period_year || '-' || lpad(r.period_month::text, 2, '0')
    INTO v_run
  FROM hr_payroll_employee_records rec
  JOIN hr_payroll_runs r ON r.id = rec.run_id
  WHERE rec.structure_id = OLD.id
    AND r.status IN ('approved', 'locked', 'paid')
  ORDER BY r.period_end DESC
  LIMIT 1;

  IF v_run IS NULL THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT max(r.period_end) INTO v_last_end
    FROM hr_payroll_employee_records rec
    JOIN hr_payroll_runs r ON r.id = rec.run_id
    WHERE rec.structure_id = OLD.id
      AND r.status IN ('approved', 'locked', 'paid');

    -- Closing it after the last frozen period is the one permitted change.
    IF NEW.effective_to IS NOT NULL
       AND NEW.effective_to >= v_last_end
       AND (OLD.effective_to IS NULL OR NEW.effective_to <= OLD.effective_to)
       AND NEW.status IN (OLD.status, 'superseded')
       AND NEW.employee_id     = OLD.employee_id
       AND NEW.effective_from  = OLD.effective_from
       AND NEW.ctc_annual      = OLD.ctc_annual
       AND NEW.gross_monthly   = OLD.gross_monthly
       AND NEW.revision_reason IS NOT DISTINCT FROM OLD.revision_reason
       AND NEW.created_by      IS NOT DISTINCT FROM OLD.created_by
       AND NEW.created_at      = OLD.created_at
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'This salary structure is used by the locked % payroll and cannot be changed. Create a new revision instead.', v_run
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.hr_guard_structure_frozen() FROM PUBLIC, anon, authenticated;
