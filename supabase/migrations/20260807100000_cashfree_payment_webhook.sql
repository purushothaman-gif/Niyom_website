/*
  # Cashfree payment webhook receiver — schema support

  Completes the loop opened by 20260707120000_add_payment_link_email_type.sql:
  send-payment-link creates a Cashfree Payment Link and logs its link_id into
  nw_deal_email_log.metadata->>'cashfree_link_id' "so a future Cashfree webhook
  can correlate the payment back to this deal". This migration ships the schema
  that webhook needs.

  Two changes:

  1. nw_payment_webhook_events — append-only raw log of EVERY webhook Cashfree
     delivers, written before any interpretation. This is the safety net: if
     correlation or the payment insert fails, the money event is still durably
     recorded and can be reconciled by hand. Mirrors bse_webhook_events.

  2. nw_insert_payment(jsonb) gains the gateway passthrough columns. The columns
     themselves have existed on nw_deal_payments since Phase 1 (created as
     "inert in Phase 1 but load-bearing for later phases"), but the RPC never
     populated them — so a webhook insert would have left provider_payment_id
     NULL, which silently DISABLES the uq_nw_deal_payments_provider_txn partial
     unique index (it is `WHERE provider_payment_id IS NOT NULL`) and with it
     the replay protection that index exists to provide.

  Why this is production-safe:
    - The table is new.
    - The RPC change is purely additive: every new key is read with
      NULLIF/COALESCE, so the existing caller (record-payment, which sends none
      of them) produces byte-identical rows to today. Rebuilt from the current
      definition in 20260729130000_drop_payment_txnref_payer_account.sql, so the
      retired transaction_reference / received_from_account columns stay dropped.
*/

-- ---------------------------------------------------------------------
-- 1. Raw webhook event log
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nw_payment_webhook_events (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at          timestamptz NOT NULL DEFAULT now(),

  provider             text NOT NULL DEFAULT 'cashfree'
                         CHECK (provider IN ('cashfree', 'razorpay', 'stripe')),
  event_type           text,          -- e.g. PAYMENT_SUCCESS_WEBHOOK
  event_at             text,          -- provider's raw event_time string

  -- Correlation keys, extracted best-effort from the payload
  link_id              text,          -- Cashfree payment-link id we generated
  order_id             text,          -- provider order id
  cf_payment_id        text,          -- provider payment id (idempotency key)
  payment_status       text,          -- SUCCESS | FAILED | USER_DROPPED | ...
  amount               numeric(18,2),

  -- Outcome of OUR processing, not the provider's
  deal_confirmation_id uuid REFERENCES nw_deal_confirmations(id) ON DELETE SET NULL,
  payment_id           uuid REFERENCES nw_deal_payments(id) ON DELETE SET NULL,
  processing_status    text NOT NULL DEFAULT 'received'
                         CHECK (processing_status IN (
                           'received',    -- logged, not yet interpreted
                           'recorded',    -- payment written to nw_deal_payments
                           'duplicate',   -- replay; payment already existed
                           'ignored',     -- non-success event, nothing to record
                           'unmatched',   -- could not map link_id -> deal
                           'error'        -- insert failed; needs manual action
                         )),
  processing_note      text,

  signature_verified   boolean NOT NULL DEFAULT false,
  source_ip            text,
  payload              jsonb NOT NULL   -- full envelope, for replay/debug
);

CREATE INDEX IF NOT EXISTS idx_nw_payment_webhook_events_received
  ON nw_payment_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_nw_payment_webhook_events_link
  ON nw_payment_webhook_events (link_id)
  WHERE link_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nw_payment_webhook_events_cf_payment
  ON nw_payment_webhook_events (cf_payment_id)
  WHERE cf_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nw_payment_webhook_events_deal
  ON nw_payment_webhook_events (deal_confirmation_id)
  WHERE deal_confirmation_id IS NOT NULL;

-- Operational index: the rows a human has to act on.
CREATE INDEX IF NOT EXISTS idx_nw_payment_webhook_events_needs_action
  ON nw_payment_webhook_events (received_at DESC)
  WHERE processing_status IN ('unmatched', 'error');

ALTER TABLE nw_payment_webhook_events ENABLE ROW LEVEL SECURITY;

-- Written only by the edge function via the service-role key (bypasses RLS).
-- Admins get READ access so 'unmatched'/'error' rows are actionable from the
-- CRM instead of requiring psql. No INSERT/UPDATE/DELETE policy exists, so the
-- log stays append-only from the application's point of view.
-- auth.uid() is wrapped in a scalar subquery so the planner evaluates it once
-- per statement (initplan) rather than once per row.
DROP POLICY IF EXISTS "Admins read payment webhook events" ON nw_payment_webhook_events;
CREATE POLICY "Admins read payment webhook events"
  ON nw_payment_webhook_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nw_employees e
      WHERE e.auth_user_id = (SELECT auth.uid())
        AND e.role IN ('admin', 'super_admin')
        AND e.status = 'active'
    )
  );

COMMENT ON TABLE nw_payment_webhook_events IS
  'Append-only log of payment-gateway webhooks. Every delivery is recorded here before interpretation, so a failed correlation or insert never loses a money event.';

-- ---------------------------------------------------------------------
-- 2. nw_insert_payment — carry the gateway columns through
-- ---------------------------------------------------------------------
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
    provider, remarks, created_by, updated_by,
    -- Gateway columns (NULL for manual entry; populated by webhook receivers)
    provider_payment_id, provider_order_id, provider_signature,
    provider_payload, provider_status
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
    NULLIF(p_data->>'updated_by', '')::uuid,
    NULLIF(p_data->>'provider_payment_id', ''),
    NULLIF(p_data->>'provider_order_id', ''),
    NULLIF(p_data->>'provider_signature', ''),
    COALESCE(p_data->'provider_payload', '{}'::jsonb),
    NULLIF(p_data->>'provider_status', '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION nw_insert_payment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nw_insert_payment(jsonb) TO authenticated, service_role;
