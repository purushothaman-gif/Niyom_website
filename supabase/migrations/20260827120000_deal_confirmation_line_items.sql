/*
  # Multi-product Deal Confirmations — header + line items

  Until now a Deal Confirmation held ONE security: security_name / isin /
  product_type / quantity / base_rate / rate_per_unit / stamp_duty_rate on the
  header, with settlement_amount and stamp_duty as GENERATED columns off
  base_rate x quantity.

  This introduces nw_deal_confirmation_items so ONE deal can hold several
  securities (a client buying multiple bonds / shares in a single confirmation).
  The model is deliberately additive and history-preserving:

    - Every EXISTING deal is backfilled with exactly ONE item copied verbatim
      from its header. Sum-over-items therefore reproduces the header's
      settlement_amount and stamp_duty to the paisa — no signed deal moves
      (a hard guard aborts the migration if any total shifts).

    - The header keeps ALL its columns. settlement_amount / stamp_duty stop being
      GENERATED (PG17 ALTER ... DROP EXPRESSION keeps the stored values) and
      become the SUM of the deal's line items, maintained by a trigger. So every
      existing reader of d.settlement_amount (the payment summary view, the
      transfer-eligible view, DealPayments, MIS) sees the correct DEAL TOTAL
      with no change at those call sites.

    - The header's scalar security fields are kept as a MIRROR of the first line
      (sort_order 0), so any code path not yet line-item-aware still shows a
      sensible primary line rather than breaking.

  Booking: each line becomes its OWN transaction + holding (holdings are per
  ISIN). nw_transactions gains deal_item_id; the one-transaction-per-deal unique
  index is replaced by one-transaction-per-LINE. The delete cascade removes the
  parent deal only when its LAST line transaction is deleted.

  A deal is single-direction (all Buy or all Sell) — transaction_type stays on
  the header and is NOT duplicated per line.
*/

-- ====================================================================
-- 1. Line items table + its own triggers
-- ====================================================================
CREATE TABLE IF NOT EXISTS nw_deal_confirmation_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        uuid NOT NULL REFERENCES nw_deal_confirmations(id) ON DELETE CASCADE,
  sort_order     int  NOT NULL DEFAULT 0,

  product_type   text NOT NULL DEFAULT '',
  security_name  text NOT NULL DEFAULT '',
  isin           text NOT NULL DEFAULT '',
  quantity       numeric(18,4) NOT NULL DEFAULT 0,
  base_rate      numeric(18,4) NOT NULL DEFAULT 0,
  rate_per_unit  numeric(18,4) NOT NULL DEFAULT 0,
  -- Per-line duty rate, exactly like the header column, so each product carries
  -- the rate that applied to it. Defaulted from nw_stamp_duty_rate() on insert.
  stamp_duty_rate numeric(9,6),

  -- Line financials — same expressions the header used, so sums reconcile.
  line_settlement numeric(18,2)
    GENERATED ALWAYS AS (round((base_rate * quantity), 2)) STORED,
  line_stamp_duty numeric(18,2)
    GENERATED ALWAYS AS (round(((base_rate * quantity) * COALESCE(stamp_duty_rate, 0) / 100), 2)) STORED,

  -- Per-line revenue basis, used only to PRE-FILL the transaction booked from
  -- this line (the transaction remains the live source for MIS / DSA payout).
  landing_cost      numeric(18,4),
  insurance_revenue numeric(18,2),
  trail_percent     numeric(9,4),
  trail_start_date  date,
  brokerage_amount  numeric(18,2),

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nw_deal_items_deal ON nw_deal_confirmation_items(deal_id, sort_order);

COMMENT ON TABLE nw_deal_confirmation_items IS
  'Line items of a deal confirmation. One row per security. The header mirrors line 0 and its settlement_amount/stamp_duty are the SUM of these lines.';

-- Default the per-line duty rate from the product type when not supplied.
CREATE OR REPLACE FUNCTION nw_deal_item_set_duty_rate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stamp_duty_rate IS NULL THEN
    NEW.stamp_duty_rate := nw_stamp_duty_rate(NEW.product_type);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nw_deal_item_duty_rate ON nw_deal_confirmation_items;
CREATE TRIGGER trg_nw_deal_item_duty_rate
  BEFORE INSERT OR UPDATE ON nw_deal_confirmation_items
  FOR EACH ROW EXECUTE FUNCTION nw_deal_item_set_duty_rate();

-- Header totals = SUM(lines); header scalars mirror line 0.
CREATE OR REPLACE FUNCTION nw_deal_recompute_from_items(p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_settle numeric(18,2);
  v_stamp  numeric(18,2);
  v_first  nw_deal_confirmation_items%ROWTYPE;
BEGIN
  SELECT COALESCE(SUM(line_settlement), 0), COALESCE(SUM(line_stamp_duty), 0)
    INTO v_settle, v_stamp
    FROM nw_deal_confirmation_items WHERE deal_id = p_deal_id;

  SELECT * INTO v_first FROM nw_deal_confirmation_items
    WHERE deal_id = p_deal_id ORDER BY sort_order, created_at LIMIT 1;

  UPDATE nw_deal_confirmations d SET
    settlement_amount = v_settle,
    stamp_duty        = v_stamp,
    product_type    = COALESCE(v_first.product_type,   d.product_type),
    security_name   = COALESCE(v_first.security_name,  d.security_name),
    isin            = COALESCE(v_first.isin,           d.isin),
    quantity        = COALESCE(v_first.quantity,       d.quantity),
    base_rate       = COALESCE(v_first.base_rate,      d.base_rate),
    rate_per_unit   = COALESCE(v_first.rate_per_unit,  d.rate_per_unit),
    stamp_duty_rate = COALESCE(v_first.stamp_duty_rate, d.stamp_duty_rate)
  WHERE d.id = p_deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION nw_deal_item_recompute_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM nw_deal_recompute_from_items(OLD.deal_id);
    RETURN OLD;
  END IF;
  PERFORM nw_deal_recompute_from_items(NEW.deal_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nw_deal_item_recompute ON nw_deal_confirmation_items;
CREATE TRIGGER trg_nw_deal_item_recompute
  AFTER INSERT OR UPDATE OR DELETE ON nw_deal_confirmation_items
  FOR EACH ROW EXECUTE FUNCTION nw_deal_item_recompute_trigger();

-- ====================================================================
-- 2. Historical backfill, with guard triggers held inert.
--    The recompute + header guard/audit triggers are disabled so re-deriving
--    93 historical deals (some accepted, some transferred) cannot be blocked
--    and cannot bump audit/updated_at. Values are proven unchanged below.
-- ====================================================================
ALTER TABLE nw_deal_confirmation_items DISABLE TRIGGER trg_nw_deal_item_recompute;
ALTER TABLE nw_deal_confirmations DISABLE TRIGGER nw_deal_confirmations_block_accepted;
ALTER TABLE nw_deal_confirmations DISABLE TRIGGER trg_nw_track_revenue_basis_changes;
ALTER TABLE nw_deal_confirmations DISABLE TRIGGER trg_nw_apply_stamp_duty_rate;
ALTER TABLE nw_deal_confirmations DISABLE TRIGGER nw_deal_confirmations_updated_at;

-- One item per existing deal, copied verbatim from the header.
INSERT INTO nw_deal_confirmation_items (
  deal_id, sort_order, product_type, security_name, isin,
  quantity, base_rate, rate_per_unit, stamp_duty_rate,
  landing_cost, insurance_revenue, trail_percent, trail_start_date, brokerage_amount
)
SELECT
  d.id, 0, d.product_type, d.security_name, d.isin,
  d.quantity, d.base_rate, d.rate_per_unit, d.stamp_duty_rate,
  d.landing_cost, d.insurance_revenue, d.trail_percent, d.trail_start_date, d.brokerage_amount
FROM nw_deal_confirmations d
WHERE NOT EXISTS (
  SELECT 1 FROM nw_deal_confirmation_items i WHERE i.deal_id = d.id
);

-- Snapshot totals to prove byte-identity after re-derivation.
CREATE TEMP TABLE _dc_before AS
  SELECT id, settlement_amount, stamp_duty FROM nw_deal_confirmations;

-- Header totals: stop generating, KEEP the stored value (PG17), then re-derive.
ALTER TABLE nw_deal_confirmations ALTER COLUMN settlement_amount DROP EXPRESSION;
ALTER TABLE nw_deal_confirmations ALTER COLUMN stamp_duty        DROP EXPRESSION;
ALTER TABLE nw_deal_confirmations ALTER COLUMN settlement_amount SET DEFAULT 0;
ALTER TABLE nw_deal_confirmations ALTER COLUMN stamp_duty        SET DEFAULT 0;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM nw_deal_confirmations LOOP
    PERFORM nw_deal_recompute_from_items(r.id);
  END LOOP;
END $$;

-- HARD GUARD: abort if any deal's totals changed.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM _dc_before b
  JOIN nw_deal_confirmations d ON d.id = b.id
  WHERE COALESCE(b.settlement_amount,0) <> COALESCE(d.settlement_amount,0)
     OR COALESCE(b.stamp_duty,0)        <> COALESCE(d.stamp_duty,0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Line-item backfill changed % deal total(s) — aborting to protect signed history.', v_bad;
  END IF;
END $$;

DROP TABLE _dc_before;

-- Restore all guard/audit triggers for runtime.
ALTER TABLE nw_deal_confirmation_items ENABLE TRIGGER trg_nw_deal_item_recompute;
ALTER TABLE nw_deal_confirmations ENABLE TRIGGER nw_deal_confirmations_block_accepted;
ALTER TABLE nw_deal_confirmations ENABLE TRIGGER trg_nw_track_revenue_basis_changes;
ALTER TABLE nw_deal_confirmations ENABLE TRIGGER trg_nw_apply_stamp_duty_rate;
ALTER TABLE nw_deal_confirmations ENABLE TRIGGER nw_deal_confirmations_updated_at;

-- ====================================================================
-- 3. RLS on the items table — an item follows its parent deal exactly.
-- ====================================================================
ALTER TABLE nw_deal_confirmation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Items follow parent deal (select)" ON nw_deal_confirmation_items;
CREATE POLICY "Items follow parent deal (select)" ON nw_deal_confirmation_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM nw_deal_confirmations d
      WHERE d.id = deal_id
        AND (d.employee_id = nw_current_employee_id() OR nw_current_emp_is_admin())
    )
  );

DROP POLICY IF EXISTS "Items follow parent deal (insert)" ON nw_deal_confirmation_items;
CREATE POLICY "Items follow parent deal (insert)" ON nw_deal_confirmation_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM nw_deal_confirmations d
      WHERE d.id = deal_id
        AND (d.employee_id = nw_current_employee_id() OR nw_current_emp_is_admin())
        AND (d.acceptance_status <> 'accepted' OR nw_current_emp_is_admin())
    )
  );

DROP POLICY IF EXISTS "Items follow parent deal (update)" ON nw_deal_confirmation_items;
CREATE POLICY "Items follow parent deal (update)" ON nw_deal_confirmation_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM nw_deal_confirmations d
      WHERE d.id = deal_id
        AND (d.employee_id = nw_current_employee_id() OR nw_current_emp_is_admin())
        AND (d.acceptance_status <> 'accepted' OR nw_current_emp_is_admin())
    )
  );

DROP POLICY IF EXISTS "Items follow parent deal (delete)" ON nw_deal_confirmation_items;
CREATE POLICY "Items follow parent deal (delete)" ON nw_deal_confirmation_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM nw_deal_confirmations d
      WHERE d.id = deal_id
        AND (d.employee_id = nw_current_employee_id() OR nw_current_emp_is_admin())
        AND (d.acceptance_status <> 'accepted' OR nw_current_emp_is_admin())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON nw_deal_confirmation_items TO authenticated;

-- ====================================================================
-- 4. Per-line transaction link + one-transaction-per-LINE uniqueness.
-- ====================================================================
ALTER TABLE nw_transactions
  ADD COLUMN IF NOT EXISTS deal_item_id uuid
  REFERENCES nw_deal_confirmation_items(id) ON DELETE SET NULL;

-- deal_item_id is pure linkage, not a financial value — exclude it from the
-- post-transfer immutability check so backfilling it (and any later ON DELETE
-- SET NULL when a line is unlinked) is never blocked on a transferred row.
CREATE OR REPLACE FUNCTION nw_check_txn_post_transfer_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.transfer_stage = 'transferred' AND NOT nw_current_emp_is_admin() THEN
    IF (to_jsonb(OLD)
          - 'landing_cost' - 'insurance_revenue' - 'trail_percent'
          - 'trail_start_date' - 'txn_date' - 'notes' - 'updated_at' - 'deal_item_id')
       IS DISTINCT FROM
       (to_jsonb(NEW)
          - 'landing_cost' - 'insurance_revenue' - 'trail_percent'
          - 'trail_start_date' - 'txn_date' - 'notes' - 'updated_at' - 'deal_item_id')
    THEN
      RAISE EXCEPTION
        'Transferred transaction % is immutable except revenue-basis fields (landing cost, insurance revenue, MF trail) and the transaction date.',
        OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill: every existing deal has exactly one line.
UPDATE nw_transactions t SET deal_item_id = i.id
FROM nw_deal_confirmation_items i
WHERE t.deal_confirmation_id IS NOT NULL
  AND i.deal_id = t.deal_confirmation_id
  AND t.deal_item_id IS NULL;

DROP INDEX IF EXISTS uq_nw_transactions_deal;
CREATE UNIQUE INDEX IF NOT EXISTS uq_nw_transactions_deal_item
  ON nw_transactions (deal_item_id)
  WHERE deal_item_id IS NOT NULL;

-- ====================================================================
-- 5. Delete cascade: remove the parent deal only when its LAST line
--    transaction is deleted.
-- ====================================================================
CREATE OR REPLACE FUNCTION nw_txn_after_delete_remove_deal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.deal_confirmation_id IS NOT NULL AND OLD.transfer_stage = 'transferred' THEN
    IF EXISTS (
      SELECT 1 FROM nw_transactions t
      WHERE t.deal_confirmation_id = OLD.deal_confirmation_id
        AND t.id <> OLD.id
    ) THEN
      RETURN NULL;  -- other line transactions remain → keep the deal
    END IF;

    DELETE FROM nw_deal_payments
     WHERE deal_confirmation_id = OLD.deal_confirmation_id
       AND reverses_payment_id IS NOT NULL;
    DELETE FROM nw_deal_payments
     WHERE deal_confirmation_id = OLD.deal_confirmation_id;
    DELETE FROM nw_deal_confirmations WHERE id = OLD.deal_confirmation_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ====================================================================
-- 6. Transfer-eligible view: unchanged columns, de-duplicated so a multi-line
--    deal appears ONCE and drops out only once EVERY line is transferred.
-- ====================================================================
CREATE OR REPLACE VIEW nw_deal_transfer_eligible
WITH (security_invoker = true) AS
  SELECT d.id AS deal_id,
    d.confirmation_number, d.client_id, d.employee_id,
    d.snap_client_name, d.snap_pan, d.snap_email, d.snap_phone,
    d.snap_dp_name, d.snap_demat_account, d.snap_bank_name, d.snap_bank_account,
    d.snap_bank_ifsc, d.snap_address,
    d.product_type, d.transaction_type, d.security_name, d.isin, d.deal_date,
    d.quantity, d.rate_per_unit, d.settlement_amount, d.stamp_duty, d.notes,
    d.accepted_at, d.signer_email, d.signed_pdf_path,
    d.landing_cost, d.insurance_revenue, d.trail_percent, d.trail_start_date, d.brokerage_amount,
    s.total_paid_amount, s.outstanding_amount, s.payment_count, s.last_payment_at
  FROM nw_deal_confirmations d
  JOIN nw_deal_payment_summary s ON s.deal_id = d.id
  WHERE d.status = 'confirmed'
    AND d.acceptance_status <> ALL (ARRAY['rejected'::text, 'expired'::text])
    AND (d.transaction_type = 'Sell'::text OR abs(s.outstanding_amount) <= 50::numeric)
    AND EXISTS (
      SELECT 1 FROM nw_deal_confirmation_items i
      WHERE i.deal_id = d.id
        AND NOT EXISTS (
          SELECT 1 FROM nw_transactions t
          WHERE t.deal_item_id = i.id AND t.transfer_stage = 'transferred'
        )
    );
