/*
  # Drop nw_deal_payments.transaction_reference and .received_from_account

  Context:
    The Record-Payment form merged "UTR Number" and "Transaction Reference"
    into a single "UTR / Transaction Ref No" field (stored in utr_number), and
    removed the "Payer Account (last few digits)" field. The two columns below
    are therefore no longer written by the app and are being retired.

  Safety:
    1. Backfill — copy any surviving transaction_reference into utr_number where
       utr_number is empty, so the merged reference stays visible in the ledger
       and on receipts. Verified before writing this migration:
         - no two backfill candidates share (deal, ref)  → no self-collision
         - no candidate ref equals an existing active UTR → no index violation
       against uq_nw_deal_payments_utr_per_deal.
    2. Recreate nw_insert_payment(jsonb) without the two columns (plpgsql bodies
       are not checked at DROP time, so the function must be rebuilt or it would
       fail at runtime after the columns are gone).
    3. Drop the columns.

  This migration MUST ship together with the frontend + record-payment edge
  function that stop selecting/writing these columns.
*/

-- 1. Backfill -----------------------------------------------------------------
-- The optimistic-lock trigger trg_nw_payment_bump_version enforces
-- row_version growth and stamps updated_at = now() on every UPDATE. This is a
-- data migration, not an application edit: bumping updated_at would falsely
-- flag all already-generated receipts as "out of date". Disable that one
-- trigger for the backfill so row_version and updated_at are left untouched.
-- Guarded by a column-existence check so re-running this migration (after the
-- column has already been dropped in step 3) is a harmless no-op.
DO $backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'nw_deal_payments'
       AND column_name = 'transaction_reference'
  ) THEN
    ALTER TABLE nw_deal_payments DISABLE TRIGGER trg_nw_payment_bump_version;

    UPDATE nw_deal_payments
       SET utr_number = transaction_reference
     WHERE transaction_reference IS NOT NULL
       AND transaction_reference <> ''
       AND (utr_number IS NULL OR utr_number = '');

    ALTER TABLE nw_deal_payments ENABLE TRIGGER trg_nw_payment_bump_version;
  END IF;
END
$backfill$;

-- 2. Recreate the insert RPC without the retired columns ----------------------
CREATE OR REPLACE FUNCTION nw_insert_payment(p_data jsonb)
RETURNS nw_deal_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deal_id uuid := (p_data->>'deal_confirmation_id')::uuid;
  v_deal_no text;
  v_seq     int;
  v_pmt_no  text;
  v_row     nw_deal_payments;
BEGIN
  IF v_deal_id IS NULL THEN
    RAISE EXCEPTION 'deal_confirmation_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT confirmation_number INTO v_deal_no
  FROM nw_deal_confirmations
  WHERE id = v_deal_id
  FOR UPDATE;

  IF v_deal_no IS NULL THEN
    RAISE EXCEPTION 'Deal % not found', v_deal_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT COALESCE(
    MAX(
      CAST(
        NULLIF(regexp_replace(payment_number, '^PMT-.*-', ''), '')
        AS integer
      )
    ), 0
  ) + 1
  INTO v_seq
  FROM nw_deal_payments
  WHERE deal_confirmation_id = v_deal_id;

  v_pmt_no := 'PMT-' || v_deal_no || '-' || v_seq::text;

  INSERT INTO nw_deal_payments (
    deal_confirmation_id, payment_number,
    amount, currency, fx_rate_to_inr,
    direction, payment_mode,
    utr_number,
    cheque_number, cheque_bank, cheque_dated, demand_draft_number,
    payment_date, value_date,
    received_by, received_from_name, received_from_bank,
    provider, remarks, created_by, updated_by
  ) VALUES (
    v_deal_id,
    v_pmt_no,
    (p_data->>'amount')::numeric,
    COALESCE(p_data->>'currency', 'INR'),
    NULLIF(p_data->>'fx_rate_to_inr', '')::numeric,
    COALESCE(p_data->>'direction', 'inflow'),
    p_data->>'payment_mode',
    NULLIF(p_data->>'utr_number', ''),
    NULLIF(p_data->>'cheque_number', ''),
    NULLIF(p_data->>'cheque_bank', ''),
    NULLIF(p_data->>'cheque_dated', '')::date,
    NULLIF(p_data->>'demand_draft_number', ''),
    (p_data->>'payment_date')::date,
    NULLIF(p_data->>'value_date', '')::date,
    NULLIF(p_data->>'received_by', '')::uuid,
    COALESCE(p_data->>'received_from_name', ''),
    NULLIF(p_data->>'received_from_bank', ''),
    COALESCE(p_data->>'provider', 'manual'),
    COALESCE(p_data->>'remarks', ''),
    NULLIF(p_data->>'created_by', '')::uuid,
    NULLIF(p_data->>'updated_by', '')::uuid
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION nw_insert_payment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nw_insert_payment(jsonb) TO authenticated, service_role;

-- 3. Drop the retired columns -------------------------------------------------
ALTER TABLE nw_deal_payments
  DROP COLUMN IF EXISTS transaction_reference,
  DROP COLUMN IF EXISTS received_from_account;
