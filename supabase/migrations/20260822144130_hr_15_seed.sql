-- =============================================================================
-- NIYOM HR & PAYROLL -- 15: seed and backfill
--
-- Everything seeded here is a DEFAULT the admin owns, not a rule the code
-- depends on. Two deliberate omissions:
--
--   * Holidays. Only the three statutory national dates are seeded, because
--     Pongal, Diwali and the rest move each year and inventing them would put
--     wrong dates into payroll. The Holiday Calendar screen adds the rest.
--   * Statutory rates. PF/ESI/PT/TDS are seeded as ordinary components with the
--     conventional rates prefilled so they are usable on day one, and marked
--     for verification. No tax law is compiled into the engine.
-- =============================================================================

-- --- Org settings ------------------------------------------------------------

INSERT INTO hr_settings (id, company_name, company_address, signatory_designation)
VALUES (1, 'NIYOM WEALTH DISTRIBUTION LLP',
        'No 126, 1st Floor, Poonamallee High Road, Varalakshmi Nagar, Maduravoyal, Chennai - 600 095, India',
        'Designated Partner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO hr_attendance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- --- HR capability matrix ----------------------------------------------------
-- hr_admin runs HR day to day but cannot change HR settings or approve payroll
-- (approve/lock/reopen are hard-gated to a CRM admin in the RPCs regardless).
INSERT INTO hr_role_permissions (hr_role, module, can_view, can_edit) VALUES
  ('hr_admin', 'employees',  true,  true),
  ('hr_admin', 'attendance', true,  true),
  ('hr_admin', 'leave',      true,  true),
  ('hr_admin', 'holidays',   true,  true),
  ('hr_admin', 'salary',     true,  true),
  ('hr_admin', 'payroll',    true,  true),
  ('hr_admin', 'payslips',   true,  true),
  ('hr_admin', 'reports',    true,  false),
  ('hr_admin', 'settings',   true,  false),
  -- A manager sees their own team through hr_is_manager_of() and decides their
  -- leave; they get no company-wide module access here.
  ('manager',  'employees',  false, false),
  ('manager',  'attendance', false, false),
  ('manager',  'leave',      false, false),
  ('manager',  'holidays',   false, false),
  ('manager',  'salary',     false, false),
  ('manager',  'payroll',    false, false),
  ('manager',  'payslips',   false, false),
  ('manager',  'reports',    false, false),
  ('manager',  'settings',   false, false)
ON CONFLICT (hr_role, module) DO NOTHING;

-- --- Work schedules ----------------------------------------------------------
-- Default mirrors the working pattern this codebase already assumes elsewhere
-- (mkt_auto_is_run_day): Sundays off, plus the 2nd and 4th Saturday.
INSERT INTO hr_work_schedules (name, weekly_offs, saturday_rule, daily_hours, is_default, active)
VALUES ('Standard - Sun off, 2nd & 4th Sat off', ARRAY[7]::smallint[], '2nd_4th', 8.00, true, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO hr_work_schedules (name, weekly_offs, saturday_rule, daily_hours, is_default, active)
VALUES ('Five Day Week - Sat & Sun off', ARRAY[6,7]::smallint[], 'none', 8.00, false, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO hr_work_schedules (name, weekly_offs, saturday_rule, daily_hours, is_default, active)
VALUES ('Six Day Week - Sun off', ARRAY[7]::smallint[], 'none', 8.00, false, true)
ON CONFLICT (name) DO NOTHING;

-- --- Pay schedule ------------------------------------------------------------

INSERT INTO hr_pay_schedules (
  name, frequency, period_start_day, attendance_cutoff_day, lop_cutoff_day,
  processing_day, payment_day, last_working_day_rule, lop_divisor_mode,
  round_net_to_rupee, is_default, active)
VALUES (
  'Monthly - calendar month', 'monthly', 1, NULL, NULL,
  NULL, 1, 'last_working_day', 'calendar_days', true, true, true)
ON CONFLICT (name) DO NOTHING;

-- --- Leave types -------------------------------------------------------------

INSERT INTO hr_leave_types (
  code, name, paid, accrual_mode, annual_quota, monthly_accrual,
  carry_forward, carry_forward_max, requires_approval, allow_half_day,
  counts_as_lop, colour, sort_order, active) VALUES
  ('CL',  'Casual Leave', true,  'monthly', 12, 1.00, false, 0,  true, true,  false, '#3b82f6', 1, true),
  ('SL',  'Sick Leave',   true,  'annual',  12, 0,    false, 0,  true, true,  false, '#f59e0b', 2, true),
  ('EL',  'Earned Leave', true,  'monthly', 15, 1.25, true,  30, true, true,  false, '#10b981', 3, true),
  ('LOP', 'Loss of Pay',  false, 'none',    0,  0,    false, 0,  true, true,  true,  '#ef4444', 4, true),
  ('COMP','Compensatory Off', true, 'none', 0,  0,    false, 0,  true, true,  false, '#8b5cf6', 5, true)
ON CONFLICT (code) DO NOTHING;

-- --- Salary components -------------------------------------------------------
-- Earnings

INSERT INTO hr_salary_components (
  code, name, kind, calc_type, percent_of, default_percent, cap_base, cap_amount,
  prorate_on_lop, taxable, include_in_gross, include_in_ctc, show_on_payslip,
  is_recurring, description, sort_order, system_seeded) VALUES
  ('BASIC',   'Basic',              'earning', 'fixed',      NULL,    NULL, NULL, NULL, true,  true,  true, true, true, true,
   'The base of the structure. Percentage components are usually expressed against it.', 10, true),
  ('HRA',     'House Rent Allowance','earning','percent_of', 'basic', 50,   NULL, NULL, true,  true,  true, true, true, true,
   'Conventionally 50% of Basic in a metro, 40% elsewhere. Verify against your policy.', 20, true),
  ('CONV',    'Conveyance Allowance','earning','fixed',      NULL,    NULL, NULL, NULL, true,  true,  true, true, true, true,
   '', 30, true),
  ('MEDICAL', 'Medical Allowance',  'earning', 'fixed',      NULL,    NULL, NULL, NULL, true,  true,  true, true, true, true,
   '', 40, true),
  ('SPECIAL', 'Special Allowance',  'earning', 'balance',    NULL,    NULL, NULL, NULL, true,  true,  true, true, true, true,
   'Balancing figure: whatever is left of monthly gross after every other earning. At most one per structure.', 90, true),
  ('BONUS',   'Bonus',              'earning', 'fixed',      NULL,    NULL, NULL, NULL, false, true,  true, false, true, false,
   'One-off. Added to a run as a payroll adjustment, not part of the standing structure.', 100, true),
  ('INCENT',  'Incentive',          'earning', 'fixed',      NULL,    NULL, NULL, NULL, false, true,  true, false, true, false,
   'One-off.', 110, true),
  ('OT',      'Overtime',           'earning', 'fixed',      NULL,    NULL, NULL, NULL, false, true,  true, false, true, false,
   'One-off, computed from the attendance overtime minutes.', 120, true),
  ('REIMB',   'Reimbursement',      'earning', 'fixed',      NULL,    NULL, NULL, NULL, false, false, false, false, true, false,
   'Expense reimbursement: paid with salary but outside gross and non-taxable.', 130, true)
ON CONFLICT (code) DO NOTHING;

-- Deductions
INSERT INTO hr_salary_components (
  code, name, kind, calc_type, percent_of, default_percent, cap_base, cap_amount,
  eligibility_max_gross, prorate_on_lop, taxable, include_in_gross, include_in_ctc,
  show_on_payslip, is_recurring, description, sort_order, system_seeded) VALUES
  ('EPF_EE', 'Provident Fund (Employee)', 'deduction', 'percent_of', 'basic', 12,   15000, NULL, NULL,
   true, false, false, false, true, true,
   'Default 12% of Basic capped at a 15,000 wage base. Confirm the rate and ceiling with your consultant before the first run.', 10, true),
  ('ESI_EE', 'ESI (Employee)',            'deduction', 'percent_of', 'gross', 0.75, NULL,  NULL, 21000,
   true, false, false, false, true, true,
   'Default 0.75% of gross, applied only while gross is at or below 21,000. Verify before use.', 20, true),
  ('PT',     'Professional Tax',          'deduction', 'fixed',      NULL,    NULL, NULL,  NULL, NULL,
   false, false, false, false, true, true,
   'Set the monthly amount per employee from your state slab. Tamil Nadu levies it half-yearly, so decide how you spread it.', 30, true),
  ('TDS',    'TDS',                       'deduction', 'fixed',      NULL,    NULL, NULL,  NULL, NULL,
   false, false, false, false, true, true,
   'Monthly TDS per employee, from your CA''s working. No tax computation is built in.', 40, true),
  ('LOAN',   'Loan / Advance Recovery',   'deduction', 'fixed',      NULL,    NULL, NULL,  NULL, NULL,
   false, false, false, false, true, false,
   'One-off.', 50, true),
  ('OTHDED', 'Other Deduction',           'deduction', 'fixed',      NULL,    NULL, NULL,  NULL, NULL,
   false, false, false, false, true, false,
   'One-off.', 60, true)
ON CONFLICT (code) DO NOTHING;

-- Employer contributions -- a company cost, part of CTC, never of net pay.
INSERT INTO hr_salary_components (
  code, name, kind, calc_type, percent_of, default_percent, cap_base,
  eligibility_max_gross, prorate_on_lop, taxable, include_in_gross, include_in_ctc,
  show_on_payslip, is_recurring, description, sort_order, system_seeded) VALUES
  ('EPF_ER', 'Provident Fund (Employer)', 'employer_contribution', 'percent_of', 'basic', 12,   15000, NULL,
   true, false, false, true, true, true,
   'Mirror of the employee share. Verify rate and ceiling.', 10, true),
  ('ESI_ER', 'ESI (Employer)',            'employer_contribution', 'percent_of', 'gross', 3.25, NULL,  21000,
   true, false, false, true, true, true,
   'Default 3.25% of gross while gross is at or below 21,000. Verify before use.', 20, true),
  ('GRAT',   'Gratuity Provision',        'employer_contribution', 'percent_of', 'basic', 4.81, NULL,  NULL,
   true, false, false, true, false, true,
   'Conventional 4.81% of Basic provision. Not a payslip line.', 30, true)
ON CONFLICT (code) DO NOTHING;

-- --- Statutory national holidays (fixed dates only) -------------------------

INSERT INTO hr_holidays (name, holiday_date, holiday_type, location, paid, description) VALUES
  ('Republic Day',    DATE '2026-01-26', 'public', 'Chennai', true, ''),
  ('Independence Day',DATE '2026-08-15', 'public', 'Chennai', true, ''),
  ('Gandhi Jayanti',  DATE '2026-10-02', 'public', 'Chennai', true, ''),
  ('Republic Day',    DATE '2027-01-26', 'public', 'Chennai', true, ''),
  ('Independence Day',DATE '2027-08-15', 'public', 'Chennai', true, ''),
  ('Gandhi Jayanti',  DATE '2027-10-02', 'public', 'Chennai', true, '')
ON CONFLICT (holiday_date, location, name) DO NOTHING;

-- --- A starting bank transfer template --------------------------------------
-- Column set is a sensible generic layout, NOT any particular bank's spec. The
-- template editor exists precisely because the bank's real format has to be
-- matched field for field.

INSERT INTO hr_bank_payment_templates (
  name, bank_name, file_format, sheet_name, include_header, date_format,
  amount_format, notes, is_default, active)
VALUES (
  'Standard Bank Transfer', '', 'xlsx', 'Salary', true, 'DD/MM/YYYY', '2dp',
  'Generic layout to start from. Open your bank''s bulk-upload template and match the column labels and order exactly before the first live transfer.',
  true, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO hr_bank_payment_template_columns (template_id, position, header_label, source, required, transform, max_length)
SELECT t.id, v.position, v.header_label, v.source, v.required, v.transform, v.max_length
FROM hr_bank_payment_templates t
CROSS JOIN (VALUES
  (1, 'Beneficiary Name',   'account_holder', true,  'upper',       50),
  (2, 'Employee ID',        'employee_code',  false, 'none',        20),
  (3, 'Account Number',     'bank_account',   true,  'digits_only', 20),
  (4, 'IFSC',               'bank_ifsc',      true,  'upper',       11),
  (5, 'Amount',             'net_pay',        true,  'none',        NULL),
  (6, 'Payment Date',       'payment_date',   false, 'none',        NULL),
  (7, 'Remarks',            'remarks',        false, 'none',        30)
) AS v(position, header_label, source, required, transform, max_length)
WHERE t.name = 'Standard Bank Transfer'
ON CONFLICT (template_id, position) DO NOTHING;

-- --- Backfill HR profiles for everyone already in the CRM -------------------
-- Without this, no existing employee can punch: hr_recompute_daily() and the
-- punch path both read the profile for the schedule and holiday location.

INSERT INTO hr_employee_profiles (
  employee_id, department, employment_type, work_location, employment_status,
  work_schedule_id, pay_schedule_id, holiday_location, hr_role)
SELECT
  e.id,
  CASE WHEN e.role IN ('admin', 'super_admin') THEN 'Management' ELSE 'Sales' END,
  'full_time', 'Chennai', 'active',
  (SELECT id FROM hr_work_schedules WHERE is_default LIMIT 1),
  (SELECT id FROM hr_pay_schedules  WHERE is_default LIMIT 1),
  'Chennai',
  'none'
FROM nw_employees e
ON CONFLICT (employee_id) DO NOTHING;