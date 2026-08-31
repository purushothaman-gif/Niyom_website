-- =============================================================================
-- Make the salary file byte-for-byte the bank's own BLKPAY sheet.
--
-- The stored template had 10 of the 15 columns, no instruction row, and a
-- Transaction Type hard-coded to NEFT for everybody. Uploading that to IDFC
-- means a rejected file at the worst possible moment, so this reconstructs it
-- from the template the bank actually issues.
--
-- WHAT WAS MISSING
--   * Custom Header - 1 to - 5. Optional to fill, but the sheet has fifteen
--     columns and a bank parser reading by position cares.
--   * Row 2, the bank's instruction text. Its parser skips it; a file without
--     it is not the file the bank handed out.
--   * Per-row routing. IDFC defines IFT as a transfer within the bank and NEFT
--     as one leaving it. Most Niyom staff bank with IDFC, so a file fixed to
--     NEFT was wrong for nearly everyone. Transaction Type is now derived by
--     comparing each beneficiary's IFSC against the company account's.
--
-- The header labels are copied verbatim from the issued file, EN DASH included
-- ("Custom Header - 1" uses U+2013, not a hyphen). Anything that matches
-- headers by string would fail on that alone.
--
-- STILL REQUIRED BEFORE THIS FILE CAN BE UPLOADED: the company's own IDFC
-- account number, which is mandatory on every row and which nobody should
-- invent. It is set in HR Settings -> Bank Templates. The generator already
-- refuses to produce a file without it.
-- =============================================================================

ALTER TABLE public.hr_bank_payment_templates
  ADD COLUMN IF NOT EXISTS include_instructions boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hr_bank_payment_templates.include_instructions IS
  'Emit the bank''s own instruction text as row 2, as the issued template does. IDFC BLKPAY needs it.';

ALTER TABLE public.hr_bank_payment_template_columns
  ADD COLUMN IF NOT EXISTS instruction_text text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.hr_bank_payment_template_columns.instruction_text IS
  'The bank''s guidance for this column, reproduced verbatim in the instruction row.';

-- Allow the new per-row source.
ALTER TABLE public.hr_bank_payment_template_columns
  DROP CONSTRAINT IF EXISTS hr_bank_payment_template_columns_source_check;
ALTER TABLE public.hr_bank_payment_template_columns
  ADD CONSTRAINT hr_bank_payment_template_columns_source_check
  CHECK (source IN ('employee_name', 'employee_code', 'account_holder', 'bank_name',
                    'bank_account', 'bank_ifsc', 'net_pay', 'payment_date',
                    'remarks', 'debit_account', 'debit_ifsc', 'sequence', 'constant',
                    'transaction_type'));

DO $mig$
DECLARE v_tpl uuid;
BEGIN
  SELECT id INTO v_tpl FROM hr_bank_payment_templates
   WHERE name = 'IDFC FIRST Bulk Payment (BLKPAY)';
  IF v_tpl IS NULL THEN
    INSERT INTO hr_bank_payment_templates (name, sheet_name, include_header, date_format, amount_format)
    VALUES ('IDFC FIRST Bulk Payment (BLKPAY)', 'Sheet1', true, 'DD/MM/YYYY', '2dp')
    RETURNING id INTO v_tpl;
  END IF;

  -- Cleared FIRST: a unique index allows only one default, so setting the new
  -- one before releasing the old collides.
  UPDATE hr_bank_payment_templates SET is_default = false WHERE id <> v_tpl AND is_default;

  UPDATE hr_bank_payment_templates
     SET sheet_name = 'Sheet1',
         include_header = true,
         include_instructions = true,
         date_format = 'DD/MM/YYYY',
         amount_format = '2dp',
         -- The bank the salary leaves FROM. Needed to tell IFT from NEFT.
         -- The account NUMBER is deliberately left alone: it is not ours to
         -- invent, and the generator refuses to build a file without it.
         debit_ifsc = COALESCE(NULLIF(debit_ifsc, ''), 'IDFB0080131'),
         is_default = true
   WHERE id = v_tpl;

  -- Rebuilt wholesale rather than patched -- the column set changed shape.
  DELETE FROM hr_bank_payment_template_columns WHERE template_id = v_tpl;

  INSERT INTO hr_bank_payment_template_columns
    (template_id, position, header_label, source, constant_value, required, transform, max_length, instruction_text)
  VALUES
  (v_tpl, 1, 'Beneficiary Name', 'account_holder', '', true, 'none', NULL, 'Enter beneficiary name.
MANDATORY'),
  (v_tpl, 2, 'Beneficiary Account Number', 'bank_account', '', true, 'digits_only', NULL, 'Enter beneficiary account number. 
This can be IDFC FIRST Bank account or other Bank account.
MANDATORY'),
  (v_tpl, 3, 'IFSC', 'bank_ifsc', '', false, 'upper', 11, 'Enter beneficiary bank IFSC code. Required only for Inter bank (NEFT/RTGS) payment.'),
  (v_tpl, 4, 'Transaction Type', 'transaction_type', '', true, 'none', NULL, 'Enter payment type:
IFT - Within Bank payment
NEFT - Inter-Bank(NEFT) payment
RTGS - Inter-Bank(RTGS) payment
MANDATORY'),
  (v_tpl, 5, 'Debit Account Number', 'debit_account', '', true, 'digits_only', NULL, 'Enter debit account number. This should be IDFC FIRST Bank account only. User should have access to do transaction on this account'),
  (v_tpl, 6, 'Transaction Date', 'payment_date', '', true, 'none', NULL, 'Enter transaction value date. Should be today''s date or future date.
MANDATORY
DD/MM/YYYY format'),
  (v_tpl, 7, 'Amount', 'net_pay', '', true, 'none', NULL, 'Enter payment amount.
MANDATORY'),
  (v_tpl, 8, 'Currency', 'constant', 'INR', true, 'none', NULL, 'Enter transaction currency. Should be INR only.
MANDATORY'),
  (v_tpl, 9, 'Beneficiary Email ID', 'constant', '', false, 'none', NULL, 'Enter beneficiary email id
OPTIONAL'),
  (v_tpl, 10, 'Remarks', 'remarks', '', false, 'none', 30, 'Enter remarks
OPTIONAL'),
  (v_tpl, 11, 'Custom Header – 1', 'constant', '', false, 'none', NULL, 'Credit Advice:
Enter Custom Info -1
Note: Header label is editable in Row 1
OPTIONAL'),
  (v_tpl, 12, 'Custom Header – 2', 'constant', '', false, 'none', NULL, 'Credit Advice:
Enter Custom Info -2
Note: Header label is editable in Row 1
OPTIONAL'),
  (v_tpl, 13, 'Custom Header – 3', 'constant', '', false, 'none', NULL, 'Credit Advice:
Enter Custom Info -3
Note: Header label is editable in Row 1
OPTIONAL'),
  (v_tpl, 14, 'Custom Header – 4', 'constant', '', false, 'none', NULL, 'Credit Advice:
Enter Custom Info -4
Note: Header label is editable in Row 1
OPTIONAL'),
  (v_tpl, 15, 'Custom Header – 5', 'constant', '', false, 'none', NULL, 'Credit Advice:
Enter Custom Info -5
Note: Header label is editable in Row 1
OPTIONAL');
END
$mig$;
