-- =============================================================================
-- NIYOM HR & PAYROLL -- 02: employee HR profile + bank details + capability helpers
--
-- nw_employees stays the identity table and is NOT extended. Two reasons:
--   1. Every active employee can already SELECT nw_employees ("Employees can
--      view all employees"), so DOB / PAN / UAN / bank details put there would
--      be readable by the whole company.
--   2. Its columns are consumed by the CRM, the mobile app and 70 edge
--      functions; widening it for HR would ripple.
-- =============================================================================

CREATE TABLE public.hr_employee_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           uuid NOT NULL UNIQUE
                          REFERENCES public.nw_employees(id) ON DELETE CASCADE,

  -- Employment
  department            text NOT NULL DEFAULT '',
  employment_type       text NOT NULL DEFAULT 'full_time'
                          CHECK (employment_type IN ('full_time', 'part_time', 'intern', 'contract', 'consultant')),
  work_location         text NOT NULL DEFAULT 'Chennai',
  reporting_manager_id  uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  probation_months      smallint NOT NULL DEFAULT 0 CHECK (probation_months BETWEEN 0 AND 24),
  confirmation_date     date,
  exit_date             date,
  exit_reason           text,
  employment_status     text NOT NULL DEFAULT 'active'
                          CHECK (employment_status IN ('active', 'probation', 'notice_period', 'exited', 'on_hold')),

  -- Personal
  date_of_birth         date,
  gender                text CHECK (gender IS NULL OR gender IN ('M', 'F', 'O')),
  personal_email        text,
  personal_phone        text,
  address               text NOT NULL DEFAULT '',
  emergency_contact_name  text NOT NULL DEFAULT '',
  emergency_contact_phone text NOT NULL DEFAULT '',

  -- Statutory identifiers. Applicability is a flag only -- this module hardcodes
  -- no tax law; whether PF actually appears on a payslip is decided by the
  -- salary components the admin configures.
  pan                   text,
  uan                   text,
  pf_number             text,
  esi_number            text,
  pf_applicable         boolean NOT NULL DEFAULT false,
  esi_applicable        boolean NOT NULL DEFAULT false,
  pt_applicable         boolean NOT NULL DEFAULT false,

  -- HR capability, independent of nw_employees.role (see hr_01).
  hr_role               text NOT NULL DEFAULT 'none'
                          CHECK (hr_role IN ('none', 'manager', 'hr_admin')),

  -- Attendance
  work_schedule_id      uuid REFERENCES public.hr_work_schedules(id) ON DELETE SET NULL,
  pay_schedule_id       uuid REFERENCES public.hr_pay_schedules(id) ON DELETE SET NULL,
  -- Field staff who legitimately work off-network: their punches auto-approve
  -- instead of landing in the pending queue.
  network_exempt        boolean NOT NULL DEFAULT false,
  holiday_location      text NOT NULL DEFAULT 'Chennai',

  notes                 text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CHECK (exit_date IS NULL OR date_of_birth IS NULL OR exit_date > date_of_birth),
  CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
);

CREATE INDEX hr_employee_profiles_manager_idx  ON public.hr_employee_profiles (reporting_manager_id);
CREATE INDEX hr_employee_profiles_status_idx   ON public.hr_employee_profiles (employment_status);
CREATE INDEX hr_employee_profiles_dept_idx     ON public.hr_employee_profiles (department);
CREATE INDEX hr_employee_profiles_hr_role_idx  ON public.hr_employee_profiles (hr_role) WHERE hr_role <> 'none';
CREATE UNIQUE INDEX hr_employee_profiles_pan_uniq ON public.hr_employee_profiles (pan) WHERE pan IS NOT NULL;
CREATE UNIQUE INDEX hr_employee_profiles_uan_uniq ON public.hr_employee_profiles (uan) WHERE uan IS NOT NULL;

CREATE TRIGGER hr_employee_profiles_touch BEFORE UPDATE ON public.hr_employee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

COMMENT ON TABLE public.hr_employee_profiles IS
  'HR-only extension of nw_employees, 1:1. Confidential fields live here because nw_employees is readable by every active employee.';

-- --- Bank details (salary credit) -------------------------------------------

CREATE TABLE public.hr_employee_bank_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  account_holder_name  text NOT NULL,
  bank_name            text NOT NULL,
  account_number       text NOT NULL,
  ifsc                 text NOT NULL,
  branch               text NOT NULL DEFAULT '',
  account_type         text NOT NULL DEFAULT 'savings' CHECK (account_type IN ('savings', 'current')),
  is_primary           boolean NOT NULL DEFAULT true,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,

  CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  CHECK (account_number ~ '^[0-9]{6,20}$')
);

-- Exactly one primary account per employee.
CREATE UNIQUE INDEX hr_employee_bank_primary
  ON public.hr_employee_bank_accounts (employee_id) WHERE is_primary AND active;
CREATE INDEX hr_employee_bank_emp_idx ON public.hr_employee_bank_accounts (employee_id);

CREATE TRIGGER hr_employee_bank_touch BEFORE UPDATE ON public.hr_employee_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- =============================================================================
-- Capability helpers used by every hr_ RLS policy.
--
-- STABLE + SECURITY DEFINER, mirroring nw_current_emp_is_admin(). They are
-- wrapped in (SELECT ...) at the call site in policies so the planner treats
-- them as an InitPlan and evaluates them once per query, not once per row --
-- the same fix applied across this database in the 2026-07 performance audit.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_current_profile_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.hr_role
  FROM hr_employee_profiles p
  JOIN nw_employees e ON e.id = p.employee_id
  WHERE e.auth_user_id = auth.uid() AND e.status = 'active'
  LIMIT 1;
$$;

-- Full HR authority: a CRM admin/super_admin always has it; an hr_admin has it
-- for the modules the super admin has granted.
CREATE OR REPLACE FUNCTION public.hr_can_view(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT nw_current_emp_is_admin()
      OR EXISTS (
           SELECT 1 FROM hr_role_permissions rp
           WHERE rp.hr_role = hr_current_profile_role()
             AND rp.module  = p_module
             AND rp.can_view
         );
$$;

CREATE OR REPLACE FUNCTION public.hr_can_edit(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT nw_current_emp_is_admin()
      OR EXISTS (
           SELECT 1 FROM hr_role_permissions rp
           WHERE rp.hr_role = hr_current_profile_role()
             AND rp.module  = p_module
             AND rp.can_edit
         );
$$;

-- True when the caller is the reporting manager of the given employee. Used to
-- let a manager see their own team's attendance and approve their leave,
-- without giving them company-wide HR access.
CREATE OR REPLACE FUNCTION public.hr_is_manager_of(p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM hr_employee_profiles p
    WHERE p.employee_id = p_employee_id
      AND p.reporting_manager_id = nw_current_employee_id()
  );
$$;

-- Anyone signed in as an active employee. HR reference data (holidays, leave
-- types) is readable by all of them.
CREATE OR REPLACE FUNCTION public.hr_is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT nw_is_active_employee(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.hr_current_profile_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_can_view(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_can_edit(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_is_manager_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_current_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_can_view(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_can_edit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_is_manager_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_is_staff() TO authenticated;