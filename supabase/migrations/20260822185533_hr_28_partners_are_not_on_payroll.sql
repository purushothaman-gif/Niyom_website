-- =============================================================================
-- Designated Partners are not employees on payroll.
--
-- They draw partner remuneration, not a salary: no salary structure, no payroll
-- record, no payslip. But they are still CRM users -- one of them administers
-- this module -- so removing their employee record was never an option. What
-- was needed was a way to say "on the books, not on the payroll".
--
-- ONE FLAG RATHER THAN A SPECIAL CASE. The alternative was to test for
-- `role = 'super_admin'` or `designation = 'Designated Partner'` wherever
-- payroll iterates people, which would silently break the moment a partner is
-- also an admin, or an admin is also salaried. `on_payroll` says exactly what
-- is meant and nothing else.
--
-- IT DELIBERATELY DOES NOT TOUCH ATTENDANCE PERMISSIONS. A partner who punches
-- still gets a proper attendance day; what stops is the nightly job
-- MANUFACTURING absence for someone who was never expected to punch. Marking a
-- partner absent every day would fill the register with noise and the dashboard
-- with false exceptions.
-- =============================================================================

ALTER TABLE public.hr_employee_profiles
  ADD COLUMN IF NOT EXISTS on_payroll boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.hr_employee_profiles.on_payroll IS
  'False for partners and anyone else who is not salaried: excluded from payroll runs, from payroll-readiness exceptions, and from nightly absence marking.';

-- 'partner' is what they actually are; the CHECK simply did not have a word for it.
ALTER TABLE public.hr_employee_profiles
  DROP CONSTRAINT IF EXISTS hr_employee_profiles_employment_type_check;
ALTER TABLE public.hr_employee_profiles
  ADD CONSTRAINT hr_employee_profiles_employment_type_check
  CHECK (employment_type IN ('full_time', 'part_time', 'intern', 'contract', 'consultant', 'partner'));

CREATE INDEX IF NOT EXISTS hr_employee_profiles_on_payroll_idx
  ON public.hr_employee_profiles (on_payroll) WHERE NOT on_payroll;

-- --- The nightly job stops inventing absence for people who never punch ------

CREATE OR REPLACE FUNCTION public.hr_recompute_all_for_date(p_date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e record; n integer := 0;
BEGIN
  FOR e IN
    SELECT emp.id
    FROM nw_employees emp
    LEFT JOIN hr_employee_profiles p ON p.employee_id = emp.id
    WHERE emp.status = 'active'
      -- Someone off payroll is only summarised on days they actually punched;
      -- the job does not create an absent day for them out of nothing.
      AND (COALESCE(p.on_payroll, true)
           OR EXISTS (SELECT 1 FROM hr_attendance_punches pu
                       WHERE pu.employee_id = emp.id AND pu.work_date = p_date))
  LOOP
    PERFORM hr_recompute_daily(e.id, p_date);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_recompute_all_for_date(date) FROM PUBLIC, anon, authenticated;