-- =============================================================================
-- Align the module with the payroll conventions Niyom already runs on, taken
-- from the July 2026 payslips and salary-structure statements.
--
-- NOTHING PERSONAL IS IN THIS FILE. Employee PANs, bank accounts, salaries and
-- payroll runs are applied as data, not as a migration, so that employee
-- personal information does not end up committed to the repository for ever.
-- Only configuration lives here.
--
-- 1. COMPONENT ROUNDING. Their payslips carry whole rupees on every line, and
--    the difference is visible: pro-rating 6,915 across 28 of 31 days gives
--    6,245.81 with paise and 6,246 without. Carried into a reconstructed
--    payslip, the paise version disagrees with the copy the employee already
--    holds.
--
-- 2. PF IS NOT CAPPED HERE. The seeded component capped the base at the 15,000
--    statutory wage ceiling, which is the common arrangement. Niyom does not
--    use it -- an employee on a 25,000 basic is deducted 3,000, which is a flat
--    12%, not the 1,800 a ceiling would give. Removing the cap is what their
--    own figures say; it is not advice about what the cap should be.
--
-- 3. NAMES. The balancing component is "Fixed Allowance" on their payslips and
--    the deduction is "Provident Fund"; matching them means a reconstructed
--    payslip reads identically to the original.
-- =============================================================================

ALTER TABLE public.hr_pay_schedules
  ADD COLUMN IF NOT EXISTS round_components_to_rupee boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hr_pay_schedules.round_components_to_rupee IS
  'Round every payslip component to the whole rupee as it is computed. Payroll systems differ; the difference shows up on the payslip.';

UPDATE public.hr_pay_schedules
   SET round_components_to_rupee = true
 WHERE is_default;

-- --- Components, as Niyom actually runs them --------------------------------

UPDATE public.hr_salary_components
   SET name = 'Fixed Allowance',
       description = 'Balancing figure: whatever is left of monthly gross after every other earning.'
 WHERE code = 'SPECIAL';

UPDATE public.hr_salary_components
   SET name        = 'Provident Fund',
       cap_base    = NULL,
       description = 'Deducted at 12% of Basic with no wage ceiling, matching the existing payroll. '
                  || 'The 15,000 statutory ceiling is NOT applied -- confirm with your consultant if that is intended.'
 WHERE code = 'EPF_EE';

-- Employer PF is not shown anywhere in the current payroll, and their own
-- salary statement puts CTC equal to twelve times gross with no employer share
-- added. Deactivated rather than deleted, so turning it back on is one click
-- and any history that referenced it still resolves.
UPDATE public.hr_salary_components
   SET active = false,
       description = 'Deactivated: the existing payroll shows no employer PF share, and its salary statements '
                  || 'set CTC to twelve times gross. Re-enable if employer contributions start being tracked.'
 WHERE code IN ('EPF_ER', 'GRAT');

-- --- The bank's actual bulk-transfer layout ---------------------------------
-- Taken from the IDFC FIRST Bank BLKPAY template. The column names, order and
-- mandatory flags are the bank's, not a guess: a mismatch is rejected at upload,
-- which is a bad thing to discover on payday.

INSERT INTO public.hr_bank_payment_templates
  (name, bank_name, file_format, sheet_name, include_header, date_format, amount_format,
   debit_account, debit_ifsc, notes, is_default, active)
VALUES
  ('IDFC FIRST Bulk Payment (BLKPAY)', 'IDFC FIRST BANK', 'xlsx', 'Sheet1', true,
   'DD/MM/YYYY', '2dp', '', '',
   'Columns match the bank''s BLKPAY template exactly. Transaction Type must be IFT for an IDFC FIRST '
   || 'beneficiary account and NEFT otherwise; IFSC is only required for NEFT/RTGS. The bank''s own file '
   || 'carries an instructions row beneath the header -- check whether your upload expects it before the '
   || 'first live run. Set the debit account on this template before generating.',
   false, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.hr_bank_payment_template_columns
  (template_id, position, header_label, source, constant_value, required, transform, max_length)
SELECT t.id, v.position, v.header_label, v.source, v.constant_value, v.required, v.transform, v.max_length
FROM public.hr_bank_payment_templates t
CROSS JOIN (VALUES
  (1,  'Beneficiary Name',           'account_holder', '',    true,  'none',        NULL::smallint),
  (2,  'Beneficiary Account Number', 'bank_account',   '',    true,  'digits_only', NULL),
  (3,  'IFSC',                       'bank_ifsc',      '',    false, 'upper',       11::smallint),
  (4,  'Transaction Type',           'constant',       'NEFT',true,  'none',        NULL),
  (5,  'Debit Account Number',       'debit_account',  '',    true,  'digits_only', NULL),
  (6,  'Transaction Date',           'payment_date',   '',    true,  'none',        NULL),
  (7,  'Amount',                     'net_pay',        '',    true,  'none',        NULL),
  (8,  'Currency',                   'constant',       'INR', true,  'none',        NULL),
  (9,  'Beneficiary Email ID',       'constant',       '',    false, 'none',        NULL),
  (10, 'Remarks',                    'remarks',        '',    false, 'none',        30::smallint)
) AS v(position, header_label, source, constant_value, required, transform, max_length)
WHERE t.name = 'IDFC FIRST Bulk Payment (BLKPAY)'
ON CONFLICT (template_id, position) DO NOTHING;