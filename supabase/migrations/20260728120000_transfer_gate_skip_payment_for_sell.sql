/*
  # Transfer Queue — SELL deals skip the "fully paid" money gate

  Business rule (owner-confirmed): when the client SELLS shares/bonds to us, the
  money flows FROM Niyom TO the client. There is no client payment to collect, so
  the "settled within ±₹50" gate that governs BUY deals must not apply. A SELL
  deal becomes transfer-eligible once it is CONFIRMED (booked) and accepted (or
  admin-overridden), regardless of the payment ledger.

  BUY deals are unchanged: they still require settlement within ±₹50.

  Two authoritative gates are updated together (mirrors 20260724120000):
    - nw_deal_transfer_eligible  → what the Transfer Queue lists.
    - nw_transfer_deal RPC       → the atomic transfer (money gate under the lock).

  Confirmed + acceptance/override gates are untouched. Columns / signature are
  unchanged, so the front-end and dependent views stay valid under CREATE OR REPLACE.
*/

-- ===========================================================================
-- 1. Eligibility view — SELL bypasses the money tolerance
-- ===========================================================================
CREATE OR REPLACE VIEW nw_deal_transfer_eligible
WITH (security_invoker = true) AS
SELECT
  d.id                        AS deal_id,
  d.confirmation_number,
  d.client_id,
  d.employee_id,
  d.snap_client_name,
  d.snap_pan,
  d.snap_email,
  d.snap_phone,
  d.snap_dp_name,
  d.snap_demat_account,
  d.snap_bank_name,
  d.snap_bank_account,
  d.snap_bank_ifsc,
  d.snap_address,
  d.product_type,
  d.transaction_type,
  d.security_name,
  d.isin,
  d.deal_date,
  d.quantity,
  d.rate_per_unit,
  d.settlement_amount,
  d.stamp_duty,
  d.notes,
  d.accepted_at,
  d.signer_email,
  d.signed_pdf_path,
  d.landing_cost,
  d.insurance_revenue,
  d.trail_percent,
  d.trail_start_date,
  d.brokerage_amount,
  s.total_paid_amount,
  s.outstanding_amount,
  s.payment_count,
  s.last_payment_at
FROM nw_deal_confirmations d
JOIN nw_deal_payment_summary s ON s.deal_id = d.id
LEFT JOIN nw_transactions t    ON t.deal_confirmation_id = d.id
WHERE d.status = 'confirmed'                              -- deal confirmation done (booked, not draft)
  AND d.acceptance_status NOT IN ('rejected', 'expired')  -- keep excluding dead records
  AND (d.transaction_type = 'Sell'                        -- SELL: no client payment to collect
       OR ABS(s.outstanding_amount) <= 50)                -- BUY: fully paid within ±50 tolerance
  AND (t.id IS NULL OR t.transfer_stage IS DISTINCT FROM 'transferred');  -- not yet transferred

-- ===========================================================================
-- 2. Transfer RPC — enforce the same SELL bypass under the row lock
--    (verbatim reproduction of 20260724120000, with the step (d) money gate
--     skipped for SELL deals)
-- ===========================================================================
DROP FUNCTION IF EXISTS nw_transfer_deal(uuid, uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION nw_transfer_deal(
  p_deal_id             uuid,
  p_admin_id            uuid,
  p_remarks             text,
  p_app_version         text    DEFAULT NULL,
  p_override_acceptance boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_employee        nw_employees%ROWTYPE;
  v_deal            nw_deal_confirmations%ROWTYPE;
  v_summary         record;
  v_client          nw_clients%ROWTYPE;
  v_rm              nw_employees%ROWTYPE;
  v_existing_txn    nw_transactions%ROWTYPE;
  v_event_id        uuid;
  v_txn_id          uuid;
  v_txn_type        text;
  v_product_type    text;
  v_sourcing_type   text;
  v_snapshot        jsonb;
  v_now             timestamptz := now();
  v_year            int         := EXTRACT(YEAR FROM v_now)::int;
  v_year_str        text        := lpad(v_year::text, 4, '0');
  v_next_seq        int;
  v_transfer_ref    text;
  v_overridden      boolean     := false;
  v_remarks_final   text;
  v_is_sell         boolean;
BEGIN
  IF p_deal_id IS NULL THEN
    RAISE EXCEPTION 'deal_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'admin_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (a) Verify the passed-in admin
  SELECT * INTO v_employee
    FROM nw_employees
   WHERE id = p_admin_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorised: admin employee not found or inactive'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_employee.role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised: admin role required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) Lock the deal row
  SELECT * INTO v_deal
    FROM nw_deal_confirmations
   WHERE id = p_deal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal % not found', p_deal_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- (c) Idempotency check
  SELECT * INTO v_existing_txn
    FROM nw_transactions
   WHERE deal_confirmation_id = p_deal_id
     AND transfer_stage       = 'transferred'
   LIMIT 1;

  IF FOUND THEN
    SELECT id INTO v_event_id
      FROM nw_deal_confirmation_events
     WHERE deal_id = p_deal_id AND event_type = 'transferred'
     ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
      'transaction_id',          v_existing_txn.id,
      'transfer_audit_id',       v_event_id,
      'transfer_reference',      v_existing_txn.transfer_reference,
      'idempotent',              true,
      'transferred_at',          v_existing_txn.transferred_at,
      'existing_transferred_at', v_existing_txn.transferred_at
    );
  END IF;

  -- (d) Re-verify eligibility.
  --     Confirmation gate: the deal must be booked (status = 'confirmed').
  --     A draft deal is never transferable, regardless of payment or override.
  IF v_deal.status <> 'confirmed' THEN
    RAISE EXCEPTION
      'Deal is not confirmed (status: %) — only a confirmed (booked) deal can be transferred.',
      v_deal.status
      USING ERRCODE = 'check_violation';
  END IF;

  --     Acceptance gate: normally the deal must be 'accepted'. An explicit
  --     admin override (p_override_acceptance) may transfer a 'pending'/'viewed'
  --     deal without the client's digital acceptance — but never a 'rejected'
  --     or 'expired' one, and never without payment (checked below, BUY only).
  IF v_deal.acceptance_status <> 'accepted' THEN
    IF v_deal.acceptance_status IN ('rejected', 'expired') THEN
      RAISE EXCEPTION
        'Deal is % — a rejected or expired deal cannot be transferred.',
        v_deal.acceptance_status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT p_override_acceptance THEN
      RAISE EXCEPTION
        'Deal is no longer accepted (current acceptance_status: %)',
        v_deal.acceptance_status
        USING ERRCODE = 'check_violation';
    END IF;
    v_overridden := true;  -- admin is booking business ahead of signature
  END IF;

  SELECT total_paid_amount, outstanding_amount, payment_status,
         payment_count, last_payment_at
    INTO v_summary
    FROM nw_deal_payment_summary
   WHERE deal_id = p_deal_id;

  -- Money gate — BUY only. On a SELL the money flows Niyom → client, so there is
  -- no client payment to settle and the tolerance check is skipped entirely.
  v_is_sell := LOWER(COALESCE(v_deal.transaction_type, '')) = 'sell';
  IF NOT v_is_sell THEN
    IF NOT FOUND OR ABS(COALESCE(v_summary.outstanding_amount, 999999)) > 50 THEN
      RAISE EXCEPTION
        'Deal is not settled within tolerance (payment_status: %, outstanding: %)',
        COALESCE(v_summary.payment_status, 'not_paid'),
        COALESCE(v_summary.outstanding_amount, 0)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (e) Map deal-side values to nw_transactions enums
  v_txn_type := LOWER(COALESCE(v_deal.transaction_type, ''));
  IF v_txn_type NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'Unsupported transaction_type on deal: %', v_deal.transaction_type
      USING ERRCODE = 'check_violation';
  END IF;

  v_product_type := CASE v_deal.product_type
    WHEN 'Unlisted Share' THEN 'unlisted_share'
    WHEN 'Secondary Bond' THEN 'secondary_bond'
    WHEN 'Primary Bond'   THEN 'primary_bond'
    WHEN 'Fixed Deposit'  THEN 'fixed_deposit'
    WHEN 'Mutual Fund'    THEN 'mutual_fund'
    WHEN 'Insurance'      THEN 'insurance'
    ELSE NULL
  END;
  IF v_product_type IS NULL THEN
    RAISE EXCEPTION
      'Transfer is not enabled for product_type "%" in v1.', v_deal.product_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- (f) Master-data snapshot
  SELECT * INTO v_client FROM nw_clients   WHERE id = v_deal.client_id;
  SELECT * INTO v_rm     FROM nw_employees WHERE id = v_deal.employee_id;
  v_sourcing_type := COALESCE(v_client.sourced_via, 'direct');

  -- (g) Allocate the human-readable Transfer Reference under the deal lock.
  SELECT COALESCE(
    MAX(
      CAST(
        NULLIF(regexp_replace(transfer_reference, '^TRF-\d{4}-', ''), '')
        AS integer
      )
    ), 0
  ) + 1
  INTO v_next_seq
  FROM nw_transactions
  WHERE transfer_reference LIKE 'TRF-' || v_year_str || '-%';

  v_transfer_ref := 'TRF-' || v_year_str || '-' || lpad(v_next_seq::text, 6, '0');

  -- Remarks carry a durable override marker so the ledger is self-explaining.
  v_remarks_final := NULLIF(p_remarks, '');
  IF v_overridden THEN
    v_remarks_final := COALESCE(v_remarks_final || ' ', '')
      || '[ADMIN OVERRIDE: transferred without client digital acceptance]';
  END IF;

  -- (h) Build the enriched snapshot
  v_snapshot := jsonb_build_object(
    'schema_version',      1,
    'snapshot_taken_at',   v_now,
    'transfer_reference',  v_transfer_ref,
    'application_version', p_app_version,

    'deal', jsonb_build_object(
      'id',                  v_deal.id,
      'confirmation_number', v_deal.confirmation_number,
      'deal_date',           v_deal.deal_date,
      'accepted_at',         v_deal.accepted_at,
      'acceptance_status',   v_deal.acceptance_status,
      'acceptance_overridden', v_overridden,
      'signer_email',        v_deal.signer_email,
      'signed_pdf_path',     v_deal.signed_pdf_path
    ),

    'client', jsonb_build_object(
      'id',            v_deal.client_id,
      'client_code',   v_client.client_code,
      'full_name',     v_deal.snap_client_name,
      'pan',           v_deal.snap_pan,
      'email',         v_deal.snap_email,
      'phone',         v_deal.snap_phone,
      'dp_name',       v_deal.snap_dp_name,
      'demat_account', v_deal.snap_demat_account,
      'bank_name',     v_deal.snap_bank_name,
      'bank_account',  v_deal.snap_bank_account,
      'bank_ifsc',     v_deal.snap_bank_ifsc,
      'address',       v_deal.snap_address,
      'sourced_via',   v_client.sourced_via,
      'dsa_id',        v_client.dsa_id
    ),

    'relationship_manager', jsonb_build_object(
      'id',            v_deal.employee_id,
      'employee_code', v_rm.employee_code,
      'full_name',     v_rm.full_name,
      'email',         v_rm.email
    ),

    'instrument', jsonb_build_object(
      'product_type_raw',  v_deal.product_type,
      'product_type_norm', v_product_type,
      'transaction_type',  v_deal.transaction_type,
      'security_name',     v_deal.security_name,
      'isin',              NULLIF(v_deal.isin, ''),
      'quantity',          v_deal.quantity,
      'rate_per_unit',     v_deal.rate_per_unit,
      'settlement_amount', v_deal.settlement_amount,
      'stamp_duty',        v_deal.stamp_duty
    ),

    'revenue_basis', jsonb_build_object(
      'landing_cost',      v_deal.landing_cost,
      'insurance_revenue', v_deal.insurance_revenue,
      'trail_percent',     v_deal.trail_percent,
      'trail_start_date',  v_deal.trail_start_date,
      'brokerage_amount',  v_deal.brokerage_amount
    ),

    'payment_summary', jsonb_build_object(
      'total_paid_amount',  v_summary.total_paid_amount,
      'outstanding_amount', v_summary.outstanding_amount,
      'payment_count',      v_summary.payment_count,
      'last_payment_at',    v_summary.last_payment_at
    ),

    'transferred_by', jsonb_build_object(
      'id',            v_employee.id,
      'employee_code', v_employee.employee_code,
      'full_name',     v_employee.full_name,
      'role',          v_employee.role
    )
  );

  -- (i) INSERT the executed transaction row
  INSERT INTO nw_transactions (
    deal_confirmation_id,
    client_id,
    employee_id,
    sourcing_type,
    txn_type,
    product_type,
    product_name,
    quantity,
    per_unit_price,
    consolidated_amount,
    txn_date,
    isin,
    landing_cost,
    insurance_revenue,
    trail_percent,
    trail_start_date,
    notes,
    snapshot,
    transfer_stage,
    transferred_at,
    transferred_by,
    transfer_remarks,
    transfer_reference
  ) VALUES (
    p_deal_id,
    v_deal.client_id,
    v_deal.employee_id,
    v_sourcing_type,
    v_txn_type,
    v_product_type,
    v_deal.security_name,
    v_deal.quantity,
    v_deal.rate_per_unit,
    v_deal.settlement_amount,
    v_deal.deal_date,
    NULLIF(v_deal.isin, ''),
    v_deal.landing_cost,
    v_deal.insurance_revenue,
    v_deal.trail_percent,
    v_deal.trail_start_date,
    COALESCE(v_remarks_final, ''),
    v_snapshot,
    'transferred',
    v_now,
    v_employee.id,
    v_remarks_final,
    v_transfer_ref
  )
  RETURNING id INTO v_txn_id;

  -- (j) Audit event — records the acceptance override, if any
  INSERT INTO nw_deal_confirmation_events
    (deal_id, event_type, actor, metadata)
  VALUES (
    p_deal_id,
    'transferred',
    'employee',
    jsonb_build_object(
      'transaction_id',        v_txn_id,
      'transfer_reference',    v_transfer_ref,
      'transferred_by',        v_employee.id,
      'transferred_by_name',   v_employee.full_name,
      'transferred_by_role',   v_employee.role,
      'remarks',               v_remarks_final,
      'acceptance_overridden', v_overridden,
      'acceptance_status_at_transfer', v_deal.acceptance_status,
      'payment_count',         v_summary.payment_count,
      'total_paid_amount',     v_summary.total_paid_amount,
      'product_type',          v_product_type,
      'txn_type',              v_txn_type,
      'settlement_amount',     v_deal.settlement_amount,
      'application_version',   p_app_version,
      'schema_version',        1
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'transaction_id',       v_txn_id,
    'transfer_audit_id',    v_event_id,
    'transfer_reference',   v_transfer_ref,
    'idempotent',           false,
    'acceptance_overridden', v_overridden,
    'transferred_at',       v_now
  );
END;
$$;

-- Access model unchanged: service_role only (the edge function is the sole path).
REVOKE ALL ON FUNCTION nw_transfer_deal(uuid, uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION nw_transfer_deal(uuid, uuid, text, text, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION nw_transfer_deal(uuid, uuid, text, text, boolean) TO service_role;
