/*
  # nw_transfer_deal — optional transfer date

  Adds p_transferred_at so the admin can set the date a deal is marked
  transferred (default = now()). When an admin reviews the queue a day or two
  late, the transaction's transferred_at should reflect the intended transfer
  date, not the clock time of the click.

  Only the transaction's transferred_at and the returned transferred_at use the
  chosen date; the snapshot_taken_at and the audit event's own timestamp stay at
  the real wall-clock now(), so the audit trail still records when the action
  actually happened.

  The signature changes (new trailing param), so the old function is dropped and
  recreated, then re-locked to service_role only (the transfer-deal edge function
  is the sole caller).
*/
DROP FUNCTION IF EXISTS public.nw_transfer_deal(uuid, uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.nw_transfer_deal(
  p_deal_id uuid, p_admin_id uuid, p_remarks text,
  p_app_version text DEFAULT NULL::text, p_override_acceptance boolean DEFAULT false,
  p_transferred_at timestamptz DEFAULT NULL::timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_employee      nw_employees%ROWTYPE;
  v_deal          nw_deal_confirmations%ROWTYPE;
  v_summary       record;
  v_client        nw_clients%ROWTYPE;
  v_rm            nw_employees%ROWTYPE;
  v_item          nw_deal_confirmation_items%ROWTYPE;
  v_existing_txn  nw_transactions%ROWTYPE;
  v_pending_txn   nw_transactions%ROWTYPE;
  v_event_id      uuid;
  v_txn_id        uuid;
  v_txn_type      text;
  v_product_type  text;
  v_sourcing_type text;
  v_snapshot      jsonb;
  v_now           timestamptz := now();
  v_transferred_at timestamptz := COALESCE(p_transferred_at, now());
  v_year_str      text := lpad(EXTRACT(YEAR FROM now())::int::text, 4, '0');
  v_next_seq      int;
  v_transfer_ref  text;
  v_overridden    boolean := false;
  v_remarks_final text;
  v_is_sell       boolean;
  v_txn_ids       uuid[] := '{}';
  v_refs          text[]  := '{}';
  v_created       int := 0;
  v_skipped       int := 0;
  v_total_items   int;
BEGIN
  IF p_deal_id IS NULL THEN
    RAISE EXCEPTION 'deal_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'admin_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_employee FROM nw_employees WHERE id = p_admin_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorised: admin employee not found or inactive' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_employee.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised: admin role required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_deal FROM nw_deal_confirmations WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal % not found', p_deal_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_deal.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Deal is not confirmed (status: %) - only a confirmed (booked) deal can be transferred.',
      v_deal.status USING ERRCODE = 'check_violation';
  END IF;

  IF v_deal.acceptance_status <> 'accepted' THEN
    IF v_deal.acceptance_status IN ('rejected', 'expired') THEN
      RAISE EXCEPTION 'Deal is % - a rejected or expired deal cannot be transferred.',
        v_deal.acceptance_status USING ERRCODE = 'check_violation';
    END IF;
    IF NOT p_override_acceptance THEN
      RAISE EXCEPTION 'Deal is no longer accepted (current acceptance_status: %)',
        v_deal.acceptance_status USING ERRCODE = 'check_violation';
    END IF;
    v_overridden := true;
  END IF;

  SELECT total_paid_amount, outstanding_amount, payment_status, payment_count, last_payment_at
    INTO v_summary FROM nw_deal_payment_summary WHERE deal_id = p_deal_id;

  v_is_sell := LOWER(COALESCE(v_deal.transaction_type, '')) = 'sell';
  IF NOT v_is_sell THEN
    IF NOT FOUND OR ABS(COALESCE(v_summary.outstanding_amount, 999999)) > 50 THEN
      RAISE EXCEPTION 'Deal is not settled within tolerance (payment_status: %, outstanding: %)',
        COALESCE(v_summary.payment_status, 'not_paid'), COALESCE(v_summary.outstanding_amount, 0)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_txn_type := LOWER(COALESCE(v_deal.transaction_type, ''));
  IF v_txn_type NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'Unsupported transaction_type on deal: %', v_deal.transaction_type USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_total_items FROM nw_deal_confirmation_items WHERE deal_id = p_deal_id;
  IF v_total_items = 0 THEN
    RAISE EXCEPTION 'Deal % has no line items to transfer', p_deal_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_client FROM nw_clients WHERE id = v_deal.client_id;
  SELECT * INTO v_rm FROM nw_employees WHERE id = v_deal.employee_id;
  v_sourcing_type := COALESCE(v_client.sourced_via, 'direct');

  v_remarks_final := NULLIF(p_remarks, '');
  IF v_overridden THEN
    v_remarks_final := COALESCE(v_remarks_final || ' ', '') || '[ADMIN OVERRIDE: transferred without client digital acceptance]';
  END IF;

  SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(transfer_reference, '^TRF-\d{4}-', ''), '') AS integer)), 0)
    INTO v_next_seq FROM nw_transactions WHERE transfer_reference LIKE 'TRF-' || v_year_str || '-%';

  FOR v_item IN
    SELECT * FROM nw_deal_confirmation_items WHERE deal_id = p_deal_id ORDER BY sort_order, created_at
  LOOP
    SELECT * INTO v_existing_txn FROM nw_transactions
     WHERE deal_item_id = v_item.id AND transfer_stage = 'transferred' LIMIT 1;
    IF FOUND THEN
      v_skipped := v_skipped + 1;
      v_txn_ids := v_txn_ids || v_existing_txn.id;
      v_refs    := v_refs || v_existing_txn.transfer_reference;
      CONTINUE;
    END IF;

    v_product_type := CASE v_item.product_type
      WHEN 'Unlisted Share' THEN 'unlisted_share'
      WHEN 'Secondary Bond' THEN 'secondary_bond'
      WHEN 'Primary Bond'   THEN 'primary_bond'
      WHEN 'Fixed Deposit'  THEN 'fixed_deposit'
      WHEN 'Mutual Fund'    THEN 'mutual_fund'
      WHEN 'Insurance'      THEN 'insurance'
      ELSE NULL END;
    IF v_product_type IS NULL THEN
      RAISE EXCEPTION 'Transfer is not enabled for product_type "%" in v1.', v_item.product_type USING ERRCODE = 'check_violation';
    END IF;

    v_next_seq := v_next_seq + 1;
    v_transfer_ref := 'TRF-' || v_year_str || '-' || lpad(v_next_seq::text, 6, '0');

    v_snapshot := jsonb_build_object(
      'schema_version', 2, 'snapshot_taken_at', v_now, 'transferred_at', v_transferred_at, 'transfer_reference', v_transfer_ref,
      'application_version', p_app_version,
      'deal', jsonb_build_object('id', v_deal.id, 'confirmation_number', v_deal.confirmation_number,
        'deal_date', v_deal.deal_date, 'accepted_at', v_deal.accepted_at, 'acceptance_status', v_deal.acceptance_status,
        'acceptance_overridden', v_overridden, 'signer_email', v_deal.signer_email, 'signed_pdf_path', v_deal.signed_pdf_path,
        'settlement_amount_total', v_deal.settlement_amount, 'line_count', v_total_items),
      'client', jsonb_build_object('id', v_deal.client_id, 'client_code', v_client.client_code,
        'full_name', v_deal.snap_client_name, 'pan', v_deal.snap_pan, 'email', v_deal.snap_email, 'phone', v_deal.snap_phone,
        'dp_name', v_deal.snap_dp_name, 'demat_account', v_deal.snap_demat_account, 'bank_name', v_deal.snap_bank_name,
        'bank_account', v_deal.snap_bank_account, 'bank_ifsc', v_deal.snap_bank_ifsc, 'address', v_deal.snap_address,
        'sourced_via', v_client.sourced_via, 'dsa_id', v_client.dsa_id),
      'relationship_manager', jsonb_build_object('id', v_deal.employee_id, 'employee_code', v_rm.employee_code,
        'full_name', v_rm.full_name, 'email', v_rm.email),
      'instrument', jsonb_build_object('deal_item_id', v_item.id, 'sort_order', v_item.sort_order,
        'product_type_raw', v_item.product_type, 'product_type_norm', v_product_type,
        'transaction_type', v_deal.transaction_type, 'security_name', v_item.security_name, 'isin', NULLIF(v_item.isin, ''),
        'quantity', v_item.quantity, 'rate_per_unit', v_item.rate_per_unit, 'base_rate', v_item.base_rate,
        'line_settlement', v_item.line_settlement, 'line_stamp_duty', v_item.line_stamp_duty),
      'revenue_basis', jsonb_build_object('landing_cost', v_item.landing_cost, 'insurance_revenue', v_item.insurance_revenue,
        'trail_percent', v_item.trail_percent, 'trail_start_date', v_item.trail_start_date, 'brokerage_amount', v_item.brokerage_amount),
      'payment_summary', jsonb_build_object('total_paid_amount', v_summary.total_paid_amount,
        'outstanding_amount', v_summary.outstanding_amount, 'payment_count', v_summary.payment_count, 'last_payment_at', v_summary.last_payment_at),
      'transferred_by', jsonb_build_object('id', v_employee.id, 'employee_code', v_employee.employee_code,
        'full_name', v_employee.full_name, 'role', v_employee.role)
    );

    SELECT * INTO v_pending_txn FROM nw_transactions
     WHERE deal_item_id = v_item.id AND transfer_stage IS DISTINCT FROM 'transferred' LIMIT 1;

    IF v_pending_txn.id IS NOT NULL THEN
      UPDATE nw_transactions SET
        transfer_stage    = 'transferred',
        transferred_at    = v_transferred_at,
        transferred_by    = v_employee.id,
        transfer_remarks  = v_remarks_final,
        transfer_reference = v_transfer_ref,
        snapshot          = v_snapshot,
        sourcing_type     = COALESCE(sourcing_type, v_sourcing_type)
      WHERE id = v_pending_txn.id
      RETURNING id INTO v_txn_id;
    ELSE
      INSERT INTO nw_transactions (
        deal_confirmation_id, deal_item_id, client_id, employee_id, sourcing_type, txn_type,
        product_type, product_name, quantity, per_unit_price, consolidated_amount,
        txn_date, isin, landing_cost, insurance_revenue, trail_percent,
        trail_start_date, notes, snapshot, transfer_stage, transferred_at,
        transferred_by, transfer_remarks, transfer_reference
      ) VALUES (
        p_deal_id, v_item.id, v_deal.client_id, v_deal.employee_id, v_sourcing_type, v_txn_type,
        v_product_type, v_item.security_name, v_item.quantity, v_item.rate_per_unit,
        v_item.line_settlement, v_deal.deal_date, NULLIF(v_item.isin, ''),
        v_item.landing_cost, v_item.insurance_revenue, v_item.trail_percent,
        v_item.trail_start_date, COALESCE(v_remarks_final, ''), v_snapshot,
        'transferred', v_transferred_at, v_employee.id, v_remarks_final, v_transfer_ref
      )
      RETURNING id INTO v_txn_id;
    END IF;

    v_created := v_created + 1;
    v_txn_ids := v_txn_ids || v_txn_id;
    v_refs    := v_refs || v_transfer_ref;
  END LOOP;

  IF v_created = 0 THEN
    SELECT id INTO v_event_id FROM nw_deal_confirmation_events
     WHERE deal_id = p_deal_id AND event_type = 'transferred' ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'transaction_id', v_txn_ids[1], 'transaction_ids', to_jsonb(v_txn_ids),
      'transfer_audit_id', v_event_id, 'transfer_reference', v_refs[1],
      'transfer_references', to_jsonb(v_refs), 'idempotent', true, 'transferred_at', v_existing_txn.transferred_at);
  END IF;

  INSERT INTO nw_deal_confirmation_events (deal_id, event_type, actor, metadata)
  VALUES (p_deal_id, 'transferred', 'employee',
    jsonb_build_object('transaction_ids', to_jsonb(v_txn_ids), 'transfer_references', to_jsonb(v_refs),
      'items_transferred', v_created, 'items_skipped', v_skipped,
      'transferred_by', v_employee.id, 'transferred_by_name', v_employee.full_name,
      'transferred_by_role', v_employee.role, 'remarks', v_remarks_final,
      'acceptance_overridden', v_overridden, 'acceptance_status_at_transfer', v_deal.acceptance_status,
      'payment_count', v_summary.payment_count, 'total_paid_amount', v_summary.total_paid_amount,
      'txn_type', v_txn_type, 'settlement_amount', v_deal.settlement_amount,
      'transferred_at', v_transferred_at, 'application_version', p_app_version, 'schema_version', 2))
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'transaction_id', v_txn_ids[1], 'transaction_ids', to_jsonb(v_txn_ids),
    'transfer_audit_id', v_event_id, 'transfer_reference', v_refs[1],
    'transfer_references', to_jsonb(v_refs), 'idempotent', false,
    'items_transferred', v_created, 'acceptance_overridden', v_overridden, 'transferred_at', v_transferred_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.nw_transfer_deal(uuid, uuid, text, text, boolean, timestamptz) FROM public;
REVOKE ALL ON FUNCTION public.nw_transfer_deal(uuid, uuid, text, text, boolean, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nw_transfer_deal(uuid, uuid, text, text, boolean, timestamptz) TO service_role;
