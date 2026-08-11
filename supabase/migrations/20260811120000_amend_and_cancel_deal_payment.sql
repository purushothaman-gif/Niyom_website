/*
  # Correcting a mis-keyed payment — nw_amend_payment / nw_cancel_payment

  Reported 2026-08-11: on DC-1786349115283 an RM recorded ₹73,00,000 against a
  ₹7,30,000 deal (one extra zero). The payment ledger had NO edit path at all —
  nw_deal_payments could only be inserted (record-payment → nw_insert_payment).
  The schema has always carried the state for corrections (row_version,
  updated_by, status/cancelled_* ) and the event enum already reserves
  'payment_updated' and 'payment_cancelled', but nothing ever wrote them.

  ## What this adds
    1. nw_amend_payment(payment_id, patch, reason, row_version)
       In-place correction of an ACTIVE payment. Allowed for the owning RM of
       the parent deal AND for admin/super_admin — a typo must be fixable by
       the person who made it, not only by an admin.

    2. nw_cancel_payment(payment_id, reason)
       Soft-delete (status='cancelled'). ADMIN ONLY, matching the policy the
       payments screen has always stated ("Cancellation of a recorded payment
       is restricted to administrators"). Voiding an entry is a heavier act
       than correcting one, and the row stays in the ledger either way.

  ## Guarantees
    - Amounts stay positive: refunds remain a separate (unbuilt) flow, so this
      cannot be used to sneak a negative leg past chk_refund_has_source.
    - Gateway-captured payments (provider <> 'manual') are NOT amendable by
      anyone. Cashfree's captured amount is the PSP's record, not ours; a wrong
      gateway amount is resolved by cancel + refund, never by rewriting it.
    - A reason is mandatory on both operations and is stored on the audit
      event, so every rupee that moves in the ledger after the fact is
      attributable.
    - Optimistic concurrency: the caller passes the row_version it read. Two
      RMs correcting the same payment cannot silently overwrite each other
      (trg_nw_payment_bump_version is the backstop).
    - Instrument fields are cleared when the mode no longer uses them, so an
      amended RTGS→cheque entry cannot keep showing the old UTR.

  ## Audit
    Both write to nw_deal_confirmation_events:
      - 'payment_updated' / 'payment_cancelled' with the reason and a
        before/after diff of only the fields that actually changed;
      - 'outstanding_updated' with the recomputed summary whenever the money
        moved (always, for a cancel).
    This mirrors trg_nw_payment_audit_after_insert, which owns the INSERT side.

  ## Note on booked deals
    Amending a payment on a deal that has already been booked into the ledger
    is permitted. Money is money: if the receipt was wrong, the ledger must say
    so even though the deal passed its fully-paid transfer gate at the time.
    The event metadata records whether a transferred transaction exists so the
    inconsistency is discoverable in the audit trail.
*/

-- =====================================================================
-- Shared: recompute + emit the outstanding_updated event for a deal
-- =====================================================================

CREATE OR REPLACE FUNCTION nw_emit_outstanding_updated(p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_paid  numeric;
  v_outstanding numeric;
  v_status      text;
BEGIN
  SELECT total_paid_amount, outstanding_amount, payment_status
    INTO v_total_paid, v_outstanding, v_status
  FROM nw_deal_payment_summary
  WHERE deal_id = p_deal_id;

  INSERT INTO nw_deal_confirmation_events (deal_id, event_type, actor, metadata)
  VALUES (
    p_deal_id, 'outstanding_updated', 'system',
    jsonb_build_object(
      'total_paid_amount',  v_total_paid,
      'outstanding_amount', v_outstanding,
      'payment_status',     v_status
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION nw_emit_outstanding_updated(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nw_emit_outstanding_updated(uuid) TO service_role;

-- =====================================================================
-- 1. Amend an active payment (owning RM or admin)
-- =====================================================================

CREATE OR REPLACE FUNCTION nw_amend_payment(
  p_payment_id  uuid,
  p_patch       jsonb,
  p_reason      text,
  p_row_version int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp_id  uuid    := nw_current_employee_id();
  v_admin   boolean := nw_current_emp_is_admin();
  v_old     nw_deal_payments%ROWTYPE;
  v_new     nw_deal_payments%ROWTYPE;
  v_owner   boolean := false;
  v_reason  text    := btrim(COALESCE(p_reason, ''));
  v_booked  boolean := false;
  v_before  jsonb;
  v_after   jsonb;
  v_summary jsonb;
  v_key     text;
  -- Fields an RM/admin may correct. Deliberately excludes deal_confirmation_id,
  -- currency/fx, direction, provider_* and every receipt/reconciliation stamp.
  v_editable text[] := ARRAY[
    'amount', 'payment_mode', 'payment_date', 'value_date',
    'utr_number', 'cheque_number', 'cheque_bank', 'cheque_dated',
    'demand_draft_number', 'received_from_name', 'received_from_bank', 'remarks'
  ];
BEGIN
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A reason for the correction is required (at least 5 characters).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_old FROM nw_deal_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_old.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active payment can be corrected (this one is %).', v_old.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_old.provider IS NOT NULL AND v_old.provider <> 'manual' THEN
    RAISE EXCEPTION
      'Payment % was captured by % and cannot be edited. Cancel it and record the correct entry.',
      v_old.payment_number, v_old.provider
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_row_version IS NOT NULL AND p_row_version <> v_old.row_version THEN
    RAISE EXCEPTION
      'This payment was changed by someone else. Reload the ledger and try again.'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- Ownership: the RM who owns the parent deal, or any admin.
  SELECT (d.employee_id = v_emp_id),
         EXISTS (
           SELECT 1 FROM nw_transactions t
           WHERE t.deal_confirmation_id = d.id AND t.transfer_stage = 'transferred'
         )
    INTO v_owner, v_booked
  FROM nw_deal_confirmations d
  WHERE d.id = v_old.deal_confirmation_id;

  IF NOT v_admin AND NOT COALESCE(v_owner, false) THEN
    RAISE EXCEPTION 'Not authorised to correct this payment'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reject unknown keys rather than silently ignoring a caller's typo.
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) LOOP
    IF NOT (v_key = ANY (v_editable)) THEN
      RAISE EXCEPTION '% cannot be corrected on a recorded payment.', v_key
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- Apply the patch. Key present = set (possibly to null); key absent = keep.
  v_new := v_old;
  IF p_patch ? 'amount'              THEN v_new.amount              := (p_patch->>'amount')::numeric; END IF;
  IF p_patch ? 'payment_mode'        THEN v_new.payment_mode        := p_patch->>'payment_mode'; END IF;
  IF p_patch ? 'payment_date'        THEN v_new.payment_date        := (p_patch->>'payment_date')::date; END IF;
  IF p_patch ? 'value_date'          THEN v_new.value_date          := NULLIF(p_patch->>'value_date', '')::date; END IF;
  IF p_patch ? 'utr_number'          THEN v_new.utr_number          := NULLIF(btrim(COALESCE(p_patch->>'utr_number', '')), ''); END IF;
  IF p_patch ? 'cheque_number'       THEN v_new.cheque_number       := NULLIF(btrim(COALESCE(p_patch->>'cheque_number', '')), ''); END IF;
  IF p_patch ? 'cheque_bank'         THEN v_new.cheque_bank         := NULLIF(btrim(COALESCE(p_patch->>'cheque_bank', '')), ''); END IF;
  IF p_patch ? 'cheque_dated'        THEN v_new.cheque_dated        := NULLIF(p_patch->>'cheque_dated', '')::date; END IF;
  IF p_patch ? 'demand_draft_number' THEN v_new.demand_draft_number := NULLIF(btrim(COALESCE(p_patch->>'demand_draft_number', '')), ''); END IF;
  IF p_patch ? 'received_from_name'  THEN v_new.received_from_name  := COALESCE(p_patch->>'received_from_name', ''); END IF;
  IF p_patch ? 'received_from_bank'  THEN v_new.received_from_bank  := NULLIF(btrim(COALESCE(p_patch->>'received_from_bank', '')), ''); END IF;
  IF p_patch ? 'remarks'             THEN v_new.remarks             := COALESCE(p_patch->>'remarks', ''); END IF;

  -- Drop instrument identifiers the new mode does not use, so an amended
  -- entry can never keep showing the previous mode's reference.
  IF v_new.payment_mode NOT IN ('imps', 'neft', 'rtgs', 'upi', 'bank_transfer') THEN
    v_new.utr_number := NULL;
  END IF;
  IF v_new.payment_mode <> 'cheque' THEN
    v_new.cheque_number := NULL;
    v_new.cheque_bank   := NULL;
    v_new.cheque_dated  := NULL;
  END IF;
  IF v_new.payment_mode <> 'demand_draft' THEN
    v_new.demand_draft_number := NULL;
  END IF;

  -- Validation (friendly errors ahead of the table CHECKs).
  IF v_new.amount IS NULL OR v_new.amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_new.payment_mode IS NULL OR v_new.payment_mode NOT IN (
       'imps', 'neft', 'rtgs', 'upi', 'cheque', 'cash',
       'bank_transfer', 'online_gateway', 'demand_draft', 'internal_adjustment') THEN
    RAISE EXCEPTION 'Invalid payment mode.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_new.payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_new.payment_mode = 'cheque' AND (v_new.cheque_number IS NULL OR v_new.cheque_bank IS NULL) THEN
    RAISE EXCEPTION 'Cheque number and bank are required for cheque payments.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Diff of only the fields that actually moved.
  SELECT COALESCE(jsonb_object_agg(k, to_jsonb(v_old) -> k), '{}'::jsonb),
         COALESCE(jsonb_object_agg(k, to_jsonb(v_new) -> k), '{}'::jsonb)
    INTO v_before, v_after
  FROM unnest(v_editable) AS k
  WHERE to_jsonb(v_old) -> k IS DISTINCT FROM to_jsonb(v_new) -> k;

  IF v_before = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing was changed.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE nw_deal_payments SET
    amount              = v_new.amount,
    payment_mode        = v_new.payment_mode,
    payment_date        = v_new.payment_date,
    value_date          = v_new.value_date,
    utr_number          = v_new.utr_number,
    cheque_number       = v_new.cheque_number,
    cheque_bank         = v_new.cheque_bank,
    cheque_dated        = v_new.cheque_dated,
    demand_draft_number = v_new.demand_draft_number,
    received_from_name  = v_new.received_from_name,
    received_from_bank  = v_new.received_from_bank,
    remarks             = v_new.remarks,
    updated_by          = v_emp_id,
    row_version         = v_old.row_version + 1
  WHERE id = p_payment_id
  RETURNING * INTO v_new;

  INSERT INTO nw_deal_confirmation_events (deal_id, event_type, actor, metadata)
  VALUES (
    v_old.deal_confirmation_id, 'payment_updated', 'employee',
    jsonb_build_object(
      'payment_id',        v_new.id,
      'payment_number',    v_new.payment_number,
      'reason',            v_reason,
      'before',            v_before,
      'after',             v_after,
      'amended_by',        v_emp_id,
      'as_admin',          v_admin,
      'deal_was_booked',   v_booked,
      'receipt_number',    v_new.receipt_number,
      'receipt_was_issued', v_new.receipt_pdf_path IS NOT NULL,
      'row_version',       v_new.row_version
    )
  );

  -- The money only moved if the amount changed; emitting unconditionally would
  -- fill the timeline with no-op summary rows on a remarks-only fix.
  IF v_before ? 'amount' THEN
    PERFORM nw_emit_outstanding_updated(v_old.deal_confirmation_id);
  END IF;

  SELECT to_jsonb(s) INTO v_summary
  FROM (
    SELECT deal_amount, total_paid_amount, outstanding_amount, payment_status
    FROM nw_deal_payment_summary WHERE deal_id = v_old.deal_confirmation_id
  ) s;

  RETURN jsonb_build_object(
    'payment', to_jsonb(v_new),
    'summary', COALESCE(v_summary, '{}'::jsonb),
    'changed', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION nw_amend_payment(uuid, jsonb, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nw_amend_payment(uuid, jsonb, text, int) TO authenticated, service_role;

-- =====================================================================
-- 2. Cancel (soft-delete) an active payment — ADMIN ONLY
-- =====================================================================

CREATE OR REPLACE FUNCTION nw_cancel_payment(
  p_payment_id uuid,
  p_reason     text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp_id  uuid    := nw_current_employee_id();
  v_admin   boolean := nw_current_emp_is_admin();
  v_old     nw_deal_payments%ROWTYPE;
  v_reason  text    := btrim(COALESCE(p_reason, ''));
  v_summary jsonb;
BEGIN
  IF v_emp_id IS NULL OR NOT v_admin THEN
    RAISE EXCEPTION 'Cancelling a recorded payment is restricted to administrators.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A reason for the cancellation is required (at least 5 characters).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_old FROM nw_deal_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_old.status <> 'active' THEN
    RAISE EXCEPTION 'Payment % is already %.', v_old.payment_number, v_old.status
      USING ERRCODE = 'check_violation';
  END IF;
  -- A reversal leg exists to offset this payment; cancelling the source would
  -- leave the refund pointing at a void entry.
  IF EXISTS (SELECT 1 FROM nw_deal_payments r
             WHERE r.reverses_payment_id = v_old.id AND r.status = 'active') THEN
    RAISE EXCEPTION 'Payment % has an active reversal against it and cannot be cancelled.',
      v_old.payment_number USING ERRCODE = 'check_violation';
  END IF;

  UPDATE nw_deal_payments SET
    status              = 'cancelled',
    cancelled_at        = now(),
    cancelled_by        = v_emp_id,
    cancellation_reason = v_reason,
    updated_by          = v_emp_id,
    row_version         = v_old.row_version + 1
  WHERE id = p_payment_id;

  INSERT INTO nw_deal_confirmation_events (deal_id, event_type, actor, metadata)
  VALUES (
    v_old.deal_confirmation_id, 'payment_cancelled', 'employee',
    jsonb_build_object(
      'payment_id',     v_old.id,
      'payment_number', v_old.payment_number,
      'amount_inr',     v_old.amount_inr,
      'mode',           v_old.payment_mode,
      'reason',         v_reason,
      'cancelled_by',   v_emp_id
    )
  );

  PERFORM nw_emit_outstanding_updated(v_old.deal_confirmation_id);

  SELECT to_jsonb(s) INTO v_summary
  FROM (
    SELECT deal_amount, total_paid_amount, outstanding_amount, payment_status
    FROM nw_deal_payment_summary WHERE deal_id = v_old.deal_confirmation_id
  ) s;

  RETURN jsonb_build_object('summary', COALESCE(v_summary, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION nw_cancel_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nw_cancel_payment(uuid, text) TO authenticated, service_role;
