-- =============================================================================
-- NIYOM HR & PAYROLL -- 06: payroll runs, snapshots, bank files, payslips, audit
--
-- Every payroll record SNAPSHOTS the employee, the structure and each component
-- amount. Nothing about a past run is ever recomputed from today's
-- configuration, which is what makes an old payslip reproducible after a salary
-- revision, a rename, or a component rate change.
-- =============================================================================

CREATE TABLE public.hr_payroll_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year       smallint NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month      smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  pay_schedule_id   uuid REFERENCES public.hr_pay_schedules(id) ON DELETE SET NULL,
  period_start      date NOT NULL,
  period_end        date NOT NULL,

  status            text NOT NULL DEFAULT 'draft' CHECK (status IN
                      ('draft', 'processing', 'review', 'approved', 'locked', 'paid', 'cancelled')),

  -- Snapshot of the rules the run was computed under.
  lop_divisor_mode  text NOT NULL DEFAULT 'calendar_days',
  calendar_days     smallint NOT NULL DEFAULT 0,

  -- Totals, maintained by hr_payroll_write_records().
  employee_count    integer NOT NULL DEFAULT 0,
  total_gross       numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions  numeric(14,2) NOT NULL DEFAULT 0,
  total_employer    numeric(14,2) NOT NULL DEFAULT 0,
  total_net         numeric(14,2) NOT NULL DEFAULT 0,
  total_lop_days    numeric(8,2)  NOT NULL DEFAULT 0,

  prepared_at       timestamptz,
  prepared_by       uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  calculated_at     timestamptz,
  approved_at       timestamptz,
  approved_by       uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  locked_at         timestamptz,
  locked_by         uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  paid_at           timestamptz,
  paid_by           uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  payment_date      date,
  reopen_count      smallint NOT NULL DEFAULT 0,
  notes             text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (period_year, period_month, pay_schedule_id),
  CHECK (period_end >= period_start)
);

CREATE INDEX hr_payroll_runs_period_idx ON public.hr_payroll_runs (period_year DESC, period_month DESC);
CREATE INDEX hr_payroll_runs_status_idx ON public.hr_payroll_runs (status);

CREATE TRIGGER hr_payroll_runs_touch BEFORE UPDATE ON public.hr_payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- --- Per-employee snapshot ---------------------------------------------------

CREATE TABLE public.hr_payroll_employee_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE RESTRICT,
  structure_id       uuid REFERENCES public.hr_salary_structures(id) ON DELETE RESTRICT,

  -- Identity snapshot -- deliberately duplicated, not joined. A payslip issued
  -- in August must still read correctly after a rename or a transfer.
  employee_code      text NOT NULL,
  full_name          text NOT NULL,
  designation        text NOT NULL DEFAULT '',
  department         text NOT NULL DEFAULT '',
  joining_date       date,
  pan                text,
  uan                text,
  -- Bank snapshot, as used for this month's transfer.
  bank_name          text NOT NULL DEFAULT '',
  bank_account       text NOT NULL DEFAULT '',
  bank_ifsc          text NOT NULL DEFAULT '',
  account_holder     text NOT NULL DEFAULT '',

  -- Attendance snapshot
  calendar_days      smallint NOT NULL DEFAULT 0,
  working_days       numeric(6,2) NOT NULL DEFAULT 0,
  present_days       numeric(6,2) NOT NULL DEFAULT 0,
  paid_leave_days    numeric(6,2) NOT NULL DEFAULT 0,
  unpaid_leave_days  numeric(6,2) NOT NULL DEFAULT 0,
  holiday_days       numeric(6,2) NOT NULL DEFAULT 0,
  weekly_off_days    numeric(6,2) NOT NULL DEFAULT 0,
  absent_days        numeric(6,2) NOT NULL DEFAULT 0,
  lop_days           numeric(6,2) NOT NULL DEFAULT 0,
  payable_days       numeric(6,2) NOT NULL DEFAULT 0,
  lop_divisor        numeric(6,2) NOT NULL DEFAULT 30,
  late_days          smallint NOT NULL DEFAULT 0,
  early_out_days     smallint NOT NULL DEFAULT 0,
  overtime_minutes   integer NOT NULL DEFAULT 0,

  -- Money
  ctc_annual         numeric(14,2) NOT NULL DEFAULT 0,
  gross_earnings     numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions   numeric(14,2) NOT NULL DEFAULT 0,
  employer_contrib   numeric(14,2) NOT NULL DEFAULT 0,
  lop_amount         numeric(14,2) NOT NULL DEFAULT 0,
  net_pay            numeric(14,2) NOT NULL DEFAULT 0,

  status             text NOT NULL DEFAULT 'included'
                       CHECK (status IN ('included', 'excluded', 'on_hold')),
  exclusion_reason   text NOT NULL DEFAULT '',
  -- Anything the reviewer must look at: missing bank details, no salary
  -- structure, unapproved punches, negative net.
  exceptions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (run_id, employee_id)
);

CREATE INDEX hr_payroll_records_run_idx ON public.hr_payroll_employee_records (run_id);
CREATE INDEX hr_payroll_records_emp_idx ON public.hr_payroll_employee_records (employee_id);

-- --- Component lines ---------------------------------------------------------
-- One table discriminated by `kind` rather than three near-identical tables.

CREATE TABLE public.hr_payroll_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id      uuid NOT NULL REFERENCES public.hr_payroll_employee_records(id) ON DELETE CASCADE,
  component_id   uuid REFERENCES public.hr_salary_components(id) ON DELETE SET NULL,
  -- Snapshot: the component master may be renamed or deactivated later.
  component_code text NOT NULL,
  component_name text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution')),
  -- Full monthly entitlement before LOP proration.
  base_amount    numeric(14,2) NOT NULL DEFAULT 0,
  -- What actually applies this month.
  amount         numeric(14,2) NOT NULL DEFAULT 0,
  prorated       boolean NOT NULL DEFAULT false,
  taxable        boolean NOT NULL DEFAULT true,
  show_on_payslip boolean NOT NULL DEFAULT true,
  -- Set when the line came from a one-off adjustment rather than the structure.
  adjustment_id  uuid,
  sort_order     smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_payroll_lines_record_idx ON public.hr_payroll_lines (record_id, kind, sort_order);

-- --- One-off adjustments (bonus, incentive, loan recovery, corrections) ------

CREATE TABLE public.hr_payroll_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  component_id  uuid REFERENCES public.hr_salary_components(id) ON DELETE SET NULL,
  label         text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution')),
  amount        numeric(14,2) NOT NULL CHECK (amount >= 0),
  -- One-offs are usually not pro-rated by LOP; the admin can override.
  prorate_on_lop boolean NOT NULL DEFAULT false,
  taxable       boolean NOT NULL DEFAULT true,
  reason        text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_payroll_adjustments_run_idx ON public.hr_payroll_adjustments (run_id, employee_id);

ALTER TABLE public.hr_payroll_lines
  ADD CONSTRAINT hr_payroll_lines_adjustment_fk
    FOREIGN KEY (adjustment_id) REFERENCES public.hr_payroll_adjustments(id) ON DELETE SET NULL;

-- --- Run lifecycle events ----------------------------------------------------

CREATE TABLE public.hr_payroll_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  event        text NOT NULL CHECK (event IN
                 ('opened', 'calculated', 'recalculated', 'approved', 'locked',
                  'reopened', 'marked_paid', 'payslips_published', 'bank_file_generated', 'cancelled')),
  actor_employee_id uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  actor_name   text NOT NULL DEFAULT '',
  reason       text NOT NULL DEFAULT '',
  before_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_payroll_events_run_idx ON public.hr_payroll_events (run_id, created_at DESC);

-- Now that hr_payroll_employee_records exists, freeze structures it references.
CREATE TRIGGER hr_salary_structures_frozen
  BEFORE UPDATE OR DELETE ON public.hr_salary_structures
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_structure_frozen();

-- --- Bank transfer templates -------------------------------------------------
-- The bank's bulk-upload format is not knowable in advance and differs per bank,
-- so the columns are data, not code.

CREATE TABLE public.hr_bank_payment_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  bank_name      text NOT NULL DEFAULT '',
  file_format    text NOT NULL DEFAULT 'xlsx' CHECK (file_format IN ('xlsx', 'csv')),
  sheet_name     text NOT NULL DEFAULT 'Salary',
  include_header boolean NOT NULL DEFAULT true,
  date_format    text NOT NULL DEFAULT 'DD/MM/YYYY',
  amount_format  text NOT NULL DEFAULT '2dp' CHECK (amount_format IN ('2dp', 'integer')),
  -- Company's own debit account, printed into a constant column when the bank
  -- format requires it.
  debit_account  text NOT NULL DEFAULT '',
  debit_ifsc     text NOT NULL DEFAULT '',
  notes          text NOT NULL DEFAULT '',
  is_default     boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX hr_bank_templates_one_default
  ON public.hr_bank_payment_templates (is_default) WHERE is_default;

CREATE TRIGGER hr_bank_templates_touch BEFORE UPDATE ON public.hr_bank_payment_templates
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

CREATE TABLE public.hr_bank_payment_template_columns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES public.hr_bank_payment_templates(id) ON DELETE CASCADE,
  position       smallint NOT NULL CHECK (position > 0),
  header_label   text NOT NULL,
  -- Where the cell's value comes from. Deliberately a closed list: the transfer
  -- file must never be able to leak a salary breakdown.
  source         text NOT NULL CHECK (source IN (
                   'employee_name', 'employee_code', 'account_holder', 'bank_name',
                   'bank_account', 'bank_ifsc', 'net_pay', 'payment_date',
                   'remarks', 'debit_account', 'debit_ifsc', 'sequence', 'constant')),
  constant_value text NOT NULL DEFAULT '',
  required       boolean NOT NULL DEFAULT false,
  transform      text NOT NULL DEFAULT 'none' CHECK (transform IN ('none', 'upper', 'lower', 'trim', 'digits_only')),
  max_length     smallint CHECK (max_length IS NULL OR max_length > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (template_id, position)
);

CREATE INDEX hr_bank_template_columns_idx ON public.hr_bank_payment_template_columns (template_id, position);

CREATE TABLE public.hr_payroll_payment_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  template_id   uuid REFERENCES public.hr_bank_payment_templates(id) ON DELETE SET NULL,
  template_name text NOT NULL DEFAULT '',
  file_name     text NOT NULL,
  storage_path  text NOT NULL DEFAULT '',
  row_count     integer NOT NULL DEFAULT 0,
  total_amount  numeric(14,2) NOT NULL DEFAULT 0,
  payment_date  date,
  generated_by  uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_payment_files_run_idx ON public.hr_payroll_payment_files (run_id, generated_at DESC);

-- --- Payslips ----------------------------------------------------------------

CREATE TABLE public.hr_payslips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  record_id       uuid NOT NULL REFERENCES public.hr_payroll_employee_records(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  payslip_number  text NOT NULL UNIQUE,
  period_year     smallint NOT NULL,
  period_month    smallint NOT NULL,
  net_pay         numeric(14,2) NOT NULL DEFAULT 0,
  storage_path    text NOT NULL DEFAULT '',
  published       boolean NOT NULL DEFAULT false,
  published_at    timestamptz,
  generated_by    uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  first_viewed_at timestamptz,
  download_count  integer NOT NULL DEFAULT 0,

  UNIQUE (run_id, employee_id)
);

CREATE INDEX hr_payslips_emp_idx ON public.hr_payslips (employee_id, period_year DESC, period_month DESC);

-- --- Audit log ---------------------------------------------------------------

CREATE TABLE public.hr_audit_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_employee_id uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  actor_name        text NOT NULL DEFAULT '',
  actor_role        text NOT NULL DEFAULT '',
  entity            text NOT NULL CHECK (entity IN (
                      'employee', 'attendance', 'leave', 'holiday', 'salary',
                      'payroll', 'payslip', 'bank_file', 'settings', 'network')),
  entity_id         uuid,
  action            text NOT NULL,
  before_value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason            text NOT NULL DEFAULT '',
  ip                inet,
  user_agent        text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_audit_entity_idx  ON public.hr_audit_logs (entity, entity_id, created_at DESC);
CREATE INDEX hr_audit_actor_idx   ON public.hr_audit_logs (actor_employee_id, created_at DESC);
CREATE INDEX hr_audit_created_idx ON public.hr_audit_logs (created_at DESC);

-- Central writer. SECURITY DEFINER so it can write even where the caller has no
-- INSERT policy -- an audit row must never be the thing that fails.
CREATE OR REPLACE FUNCTION public.hr_audit(
  p_entity text, p_entity_id uuid, p_action text,
  p_before jsonb DEFAULT '{}'::jsonb, p_after jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT '', p_ip inet DEFAULT NULL, p_user_agent text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id   uuid;
  v_emp  record;
BEGIN
  SELECT id, full_name, role INTO v_emp
  FROM nw_employees WHERE auth_user_id = auth.uid() LIMIT 1;

  INSERT INTO hr_audit_logs (
    actor_employee_id, actor_name, actor_role, entity, entity_id,
    action, before_value, after_value, reason, ip, user_agent)
  VALUES (
    v_emp.id, COALESCE(v_emp.full_name, 'system'), COALESCE(v_emp.role, 'system'),
    p_entity, p_entity_id, p_action,
    COALESCE(p_before, '{}'::jsonb), COALESCE(p_after, '{}'::jsonb),
    COALESCE(p_reason, ''), p_ip, COALESCE(p_user_agent, ''))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_audit(text, uuid, text, jsonb, jsonb, text, inet, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_audit(text, uuid, text, jsonb, jsonb, text, inet, text) TO authenticated;