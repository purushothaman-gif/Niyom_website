-- =============================================================================
-- NIYOM HR & PAYROLL -- 07: row level security
--
-- Three shapes:
--   reference  : any active employee reads, HR writes   (holidays, leave types)
--   self+HR    : the owner reads their own row, HR reads all
--   HR only    : salary, payroll, bank files, audit -- never an employee
--
-- Every helper call is wrapped in (SELECT ...) so the planner hoists it into an
-- InitPlan and evaluates it once per query rather than once per row -- the same
-- correction applied across this database in the 2026-07 performance audit.
--
-- Note there is NO insert policy on hr_attendance_punches, hr_attendance_daily
-- or hr_leave_days for anyone: those tables are written only by SECURITY
-- DEFINER functions, so a punch cannot be forged through PostgREST.
-- =============================================================================

-- Whether an employee may see their own salary structure. Configurable because
-- the spec says "view salary information where permitted", and "permitted" is
-- an org decision, not a code decision.
ALTER TABLE public.hr_settings
  ADD COLUMN IF NOT EXISTS employee_can_view_salary boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.hr_employee_salary_visible()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT employee_can_view_salary FROM hr_settings WHERE id = 1), true);
$$;
REVOKE ALL ON FUNCTION public.hr_employee_salary_visible() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_employee_salary_visible() TO authenticated;

-- Enable RLS everywhere. A table with RLS on and no policy denies everything,
-- which is the correct default for the ones written only by RPCs.
ALTER TABLE public.hr_role_permissions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_settings                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_work_schedules                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_pay_schedules                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employee_profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_employee_bank_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_allowed_networks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance_punches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance_adjustments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_attendance_daily              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_types                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_balances                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_requests                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_days                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_holidays                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_salary_components             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_salary_component_slabs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_salary_structures             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_salary_structure_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll_runs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll_employee_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll_lines                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll_adjustments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_bank_payment_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_bank_payment_template_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payroll_payment_files         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payslips                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_audit_logs                    ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- reference --

CREATE POLICY hr_role_permissions_read ON public.hr_role_permissions
  FOR SELECT TO authenticated USING ((SELECT hr_is_staff()));
CREATE POLICY hr_role_permissions_write ON public.hr_role_permissions
  FOR ALL TO authenticated
  USING ((SELECT nw_current_emp_is_admin())) WITH CHECK ((SELECT nw_current_emp_is_admin()));

CREATE POLICY hr_settings_read ON public.hr_settings
  FOR SELECT TO authenticated USING ((SELECT hr_is_staff()));
CREATE POLICY hr_settings_write ON public.hr_settings
  FOR ALL TO authenticated
  USING ((SELECT nw_current_emp_is_admin())) WITH CHECK ((SELECT nw_current_emp_is_admin()));

CREATE POLICY hr_work_schedules_read ON public.hr_work_schedules
  FOR SELECT TO authenticated USING ((SELECT hr_is_staff()));
CREATE POLICY hr_work_schedules_write ON public.hr_work_schedules
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('settings'))) WITH CHECK ((SELECT hr_can_edit('settings')));

CREATE POLICY hr_pay_schedules_read ON public.hr_pay_schedules
  FOR SELECT TO authenticated USING ((SELECT hr_is_staff()));
CREATE POLICY hr_pay_schedules_write ON public.hr_pay_schedules
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('settings'))) WITH CHECK ((SELECT hr_can_edit('settings')));

CREATE POLICY hr_holidays_read ON public.hr_holidays
  FOR SELECT TO authenticated USING ((SELECT hr_is_staff()));
CREATE POLICY hr_holidays_write ON public.hr_holidays
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('holidays'))) WITH CHECK ((SELECT hr_can_edit('holidays')));

CREATE POLICY hr_leave_types_read ON public.hr_leave_types
  FOR SELECT TO authenticated USING ((SELECT hr_is_staff()));
CREATE POLICY hr_leave_types_write ON public.hr_leave_types
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('leave'))) WITH CHECK ((SELECT hr_can_edit('leave')));

CREATE POLICY hr_attendance_settings_read ON public.hr_attendance_settings
  FOR SELECT TO authenticated USING ((SELECT hr_is_staff()));
CREATE POLICY hr_attendance_settings_write ON public.hr_attendance_settings
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('attendance'))) WITH CHECK ((SELECT hr_can_edit('attendance')));

-- Office IPs are NOT reference data: an employee who can read them learns
-- exactly what to spoof. HR only.
CREATE POLICY hr_allowed_networks_read ON public.hr_allowed_networks
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('attendance')));
CREATE POLICY hr_allowed_networks_write ON public.hr_allowed_networks
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('attendance'))) WITH CHECK ((SELECT hr_can_edit('attendance')));

-- ------------------------------------------------------------- people data --

CREATE POLICY hr_profiles_read ON public.hr_employee_profiles
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('employees'))
    OR reporting_manager_id = (SELECT nw_current_employee_id())
  );
CREATE POLICY hr_profiles_hr_write ON public.hr_employee_profiles
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('employees'))) WITH CHECK ((SELECT hr_can_edit('employees')));
-- Self-service: the column guard trigger decides what may actually change.
CREATE POLICY hr_profiles_self_update ON public.hr_employee_profiles
  FOR UPDATE TO authenticated
  USING (employee_id = (SELECT nw_current_employee_id()))
  WITH CHECK (employee_id = (SELECT nw_current_employee_id()));

CREATE POLICY hr_bank_read ON public.hr_employee_bank_accounts
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('employees'))
  );
-- Deliberately no self-write: changing the account salary is credited to is a
-- fraud vector, so it stays an HR action with an audit row.
CREATE POLICY hr_bank_write ON public.hr_employee_bank_accounts
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('employees'))) WITH CHECK ((SELECT hr_can_edit('employees')));

-- -------------------------------------------------------------- attendance --

CREATE POLICY hr_punches_read ON public.hr_attendance_punches
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('attendance'))
    OR (SELECT hr_is_manager_of(employee_id))
  );
-- No INSERT policy at all: punches are created only by hr_record_punch(), which
-- is the one place the server-detected IP is applied.
CREATE POLICY hr_punches_review ON public.hr_attendance_punches
  FOR UPDATE TO authenticated
  USING ((SELECT hr_can_edit('attendance'))) WITH CHECK ((SELECT hr_can_edit('attendance')));

CREATE POLICY hr_adjustments_read ON public.hr_attendance_adjustments
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('attendance'))
    OR (SELECT hr_is_manager_of(employee_id))
  );
CREATE POLICY hr_adjustments_self_insert ON public.hr_attendance_adjustments
  FOR INSERT TO authenticated WITH CHECK (
    employee_id = (SELECT nw_current_employee_id())
    AND status = 'pending'
    AND kind <> 'admin_override'
  );
CREATE POLICY hr_adjustments_self_update ON public.hr_attendance_adjustments
  FOR UPDATE TO authenticated
  USING (employee_id = (SELECT nw_current_employee_id()) AND status = 'pending')
  WITH CHECK (employee_id = (SELECT nw_current_employee_id()));
CREATE POLICY hr_adjustments_hr_write ON public.hr_attendance_adjustments
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('attendance'))) WITH CHECK ((SELECT hr_can_edit('attendance')));

CREATE POLICY hr_daily_read ON public.hr_attendance_daily
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('attendance'))
    OR (SELECT hr_is_manager_of(employee_id))
  );
-- Derived table: written only by hr_recompute_daily(). No write policy.

-- ------------------------------------------------------------------- leave --

CREATE POLICY hr_leave_balances_read ON public.hr_leave_balances
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('leave'))
    OR (SELECT hr_is_manager_of(employee_id))
  );
CREATE POLICY hr_leave_balances_write ON public.hr_leave_balances
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('leave'))) WITH CHECK ((SELECT hr_can_edit('leave')));

CREATE POLICY hr_leave_requests_read ON public.hr_leave_requests
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('leave'))
    OR (SELECT hr_is_manager_of(employee_id))
  );
CREATE POLICY hr_leave_requests_self_insert ON public.hr_leave_requests
  FOR INSERT TO authenticated WITH CHECK (
    employee_id = (SELECT nw_current_employee_id()) AND status = 'pending'
  );
CREATE POLICY hr_leave_requests_self_update ON public.hr_leave_requests
  FOR UPDATE TO authenticated
  USING (employee_id = (SELECT nw_current_employee_id()) AND status IN ('pending', 'approved'))
  WITH CHECK (employee_id = (SELECT nw_current_employee_id()));
CREATE POLICY hr_leave_requests_hr_write ON public.hr_leave_requests
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('leave'))) WITH CHECK ((SELECT hr_can_edit('leave')));

CREATE POLICY hr_leave_days_read ON public.hr_leave_days
  FOR SELECT TO authenticated USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT hr_can_view('leave'))
    OR (SELECT hr_is_manager_of(employee_id))
  );
-- Materialised by hr_approve_leave(). No write policy.

-- ------------------------------------------------------------------ salary --

CREATE POLICY hr_salary_components_read ON public.hr_salary_components
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('salary')));
CREATE POLICY hr_salary_components_write ON public.hr_salary_components
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('salary'))) WITH CHECK ((SELECT hr_can_edit('salary')));

CREATE POLICY hr_component_slabs_read ON public.hr_salary_component_slabs
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('salary')));
CREATE POLICY hr_component_slabs_write ON public.hr_salary_component_slabs
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('salary'))) WITH CHECK ((SELECT hr_can_edit('salary')));

CREATE POLICY hr_structures_read ON public.hr_salary_structures
  FOR SELECT TO authenticated USING (
    (SELECT hr_can_view('salary'))
    OR (employee_id = (SELECT nw_current_employee_id()) AND (SELECT hr_employee_salary_visible()))
  );
CREATE POLICY hr_structures_write ON public.hr_salary_structures
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('salary'))) WITH CHECK ((SELECT hr_can_edit('salary')));

CREATE POLICY hr_structure_lines_read ON public.hr_salary_structure_lines
  FOR SELECT TO authenticated USING (
    (SELECT hr_can_view('salary'))
    OR EXISTS (
      SELECT 1 FROM hr_salary_structures s
      WHERE s.id = hr_salary_structure_lines.structure_id
        AND s.employee_id = (SELECT nw_current_employee_id())
        AND (SELECT hr_employee_salary_visible())
    )
  );
CREATE POLICY hr_structure_lines_write ON public.hr_salary_structure_lines
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('salary'))) WITH CHECK ((SELECT hr_can_edit('salary')));

-- ----------------------------------------------------------------- payroll --

CREATE POLICY hr_payroll_runs_read ON public.hr_payroll_runs
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('payroll')));
CREATE POLICY hr_payroll_runs_write ON public.hr_payroll_runs
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));

-- An employee sees their own figures only once the payslip is PUBLISHED, so a
-- draft run under review is never visible to the people in it.
CREATE POLICY hr_payroll_records_read ON public.hr_payroll_employee_records
  FOR SELECT TO authenticated USING (
    (SELECT hr_can_view('payroll'))
    OR (
      employee_id = (SELECT nw_current_employee_id())
      AND EXISTS (
        SELECT 1 FROM hr_payslips ps
        WHERE ps.record_id = hr_payroll_employee_records.id AND ps.published
      )
    )
  );
CREATE POLICY hr_payroll_records_write ON public.hr_payroll_employee_records
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));

CREATE POLICY hr_payroll_lines_read ON public.hr_payroll_lines
  FOR SELECT TO authenticated USING (
    (SELECT hr_can_view('payroll'))
    OR EXISTS (
      SELECT 1
      FROM hr_payroll_employee_records rec
      JOIN hr_payslips ps ON ps.record_id = rec.id AND ps.published
      WHERE rec.id = hr_payroll_lines.record_id
        AND rec.employee_id = (SELECT nw_current_employee_id())
    )
  );
CREATE POLICY hr_payroll_lines_write ON public.hr_payroll_lines
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));

CREATE POLICY hr_payroll_adjustments_all ON public.hr_payroll_adjustments
  FOR ALL TO authenticated
  USING ((SELECT hr_can_view('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));

CREATE POLICY hr_payroll_events_read ON public.hr_payroll_events
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('payroll')));

-- Bank transfer machinery: HR only, never an employee, in any form.
CREATE POLICY hr_bank_templates_all ON public.hr_bank_payment_templates
  FOR ALL TO authenticated
  USING ((SELECT hr_can_view('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));
CREATE POLICY hr_bank_template_columns_all ON public.hr_bank_payment_template_columns
  FOR ALL TO authenticated
  USING ((SELECT hr_can_view('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));
CREATE POLICY hr_payment_files_all ON public.hr_payroll_payment_files
  FOR ALL TO authenticated
  USING ((SELECT hr_can_view('payroll'))) WITH CHECK ((SELECT hr_can_edit('payroll')));

-- ---------------------------------------------------------------- payslips --

CREATE POLICY hr_payslips_read ON public.hr_payslips
  FOR SELECT TO authenticated USING (
    (SELECT hr_can_view('payslips'))
    OR (employee_id = (SELECT nw_current_employee_id()) AND published)
  );
CREATE POLICY hr_payslips_write ON public.hr_payslips
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('payslips'))) WITH CHECK ((SELECT hr_can_edit('payslips')));

-- ------------------------------------------------------------------- audit --
-- Read-only even for admins. Rows arrive through hr_audit() (SECURITY DEFINER);
-- there is no INSERT, UPDATE or DELETE policy, so an audit trail cannot be
-- edited or erased through the API by anyone.
CREATE POLICY hr_audit_read ON public.hr_audit_logs
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('settings')));