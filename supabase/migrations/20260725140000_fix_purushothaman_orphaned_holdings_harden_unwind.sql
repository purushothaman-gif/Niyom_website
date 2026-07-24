/*
  # Fix orphaned client-portfolio holdings + harden the transaction-delete unwind

  Owner-reported 2026-07-25 (purushothaman@niyomwealth.com): a client
  (PURUSHOTHAMAN S) whose transactions were all deleted in the CRM still saw a
  populated portfolio in the client login. Root cause: a client's visible
  portfolio is nw_holdings, a denormalised table with NO foreign key to
  nw_transactions — the two are matched only by the
  (client_id, product_name, product_type) name-triple. Deleting a transaction
  clears its holding via nw_unwind_txn_holding(), which looked the holding up by
  an EXACT product_name match and silently did nothing (`IF NOT FOUND RETURN`)
  when the name differed by case/whitespace — orphaning the holding.

  ## Changes
    1. nw_unwind_txn_holding(): match the holding case- and whitespace-
       insensitively so a name that differs only in casing/spacing can no longer
       silently orphan a holding. Behaviour is otherwise identical.
    2. nw_recompute_portfolio_value(client): reusable reconciler that resets a
       client's portfolio_value to the sum of their holdings' current_value.
    3. nw_orphaned_holdings: read-only audit view listing every holding that has
       no backing buy transaction (for periodic review; note that directly-
       entered holdings legitimately appear here).
    4. One-off, owner-approved data fix: remove PURUSHOTHAMAN S's two orphaned
       holdings (NSE ₹20,00,000 unlisted_share, akara capital ₹5,08,000
       secondary_bond) and recompute his portfolio_value. Guarded so it only
       runs while the client still has zero transactions — i.e. the holdings are
       genuinely unbacked. No other client's data is touched.

  ## NOT included (deliberately)
    A UNIQUE constraint on nw_holdings(client_id, product_name, product_type) —
    it would prevent duplicate holdings (e.g. one client currently has three
    "AUTO TRICKS" rows) but requires de-duplicating existing rows on another
    client first, which is pending owner review. Tracked separately.
*/

-- =====================================================================
-- 1. Reusable portfolio_value reconciler (defined first — the unwind calls it)
-- =====================================================================

CREATE OR REPLACE FUNCTION nw_recompute_portfolio_value(p_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE nw_clients c
     SET portfolio_value = COALESCE(
           (SELECT SUM(current_value) FROM nw_holdings WHERE client_id = c.id), 0)
   WHERE c.id = p_client_id;
END;
$$;
REVOKE ALL ON FUNCTION nw_recompute_portfolio_value(uuid) FROM PUBLIC;

-- =====================================================================
-- 2. Harden the unwind: case/whitespace-insensitive holding match
-- =====================================================================

CREATE OR REPLACE FUNCTION nw_unwind_txn_holding(p_txn nw_transactions)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount  numeric;
  v_hold    nw_holdings%ROWTYPE;
  v_new_qty numeric;
  v_new_inv numeric;
BEGIN
  IF p_txn.txn_type <> 'buy' THEN
    RETURN;
  END IF;

  v_amount := CASE
    WHEN p_txn.product_type = 'secondary_bond' AND p_txn.client_price IS NOT NULL
      THEN p_txn.client_price * COALESCE(p_txn.quantity, 0)
    ELSE COALESCE(p_txn.consolidated_amount, 0)
  END;

  -- Match the holding the same way a human reads "same product": exact
  -- product_type, and product_name compared case- and whitespace-insensitively.
  -- Prefer the most recently touched holding if more than one matches.
  SELECT * INTO v_hold
    FROM nw_holdings
   WHERE client_id    = p_txn.client_id
     AND product_type = p_txn.product_type
     AND lower(btrim(product_name)) = lower(btrim(p_txn.product_name))
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;  -- transaction never contributed to a holding
  END IF;

  v_new_qty := COALESCE(v_hold.quantity, 0)        - COALESCE(p_txn.quantity, 0);
  v_new_inv := COALESCE(v_hold.invested_amount, 0) - v_amount;

  IF v_new_qty <= 0 OR v_new_inv <= 0 THEN
    DELETE FROM nw_holdings WHERE id = v_hold.id;
  ELSE
    UPDATE nw_holdings
       SET quantity        = v_new_qty,
           invested_amount = v_new_inv,
           avg_cost        = v_new_inv / v_new_qty,
           current_value   = v_new_inv,
           updated_at      = now()
     WHERE id = v_hold.id;
  END IF;

  PERFORM nw_recompute_portfolio_value(p_txn.client_id);
END;
$$;
REVOKE ALL ON FUNCTION nw_unwind_txn_holding(nw_transactions) FROM PUBLIC;

-- =====================================================================
-- 3. Audit view: holdings with no backing buy transaction
-- =====================================================================

CREATE OR REPLACE VIEW nw_orphaned_holdings AS
SELECT h.id            AS holding_id,
       h.client_id,
       c.full_name,
       c.pan,
       h.product_name,
       h.product_type,
       h.quantity,
       h.current_value,
       h.created_at,
       h.updated_at
  FROM nw_holdings h
  JOIN nw_clients  c ON c.id = h.client_id
 WHERE NOT EXISTS (
         SELECT 1 FROM nw_transactions t
          WHERE t.client_id    = h.client_id
            AND t.txn_type      = 'buy'
            AND t.product_type  = h.product_type
            AND lower(btrim(t.product_name)) = lower(btrim(h.product_name))
       );

-- =====================================================================
-- 4. One-off data fix: PURUSHOTHAMAN S's orphaned ghost portfolio
--    Client id b4ffff5c-3d86-42e1-b8a0-4b1a33d7d880 (PAN BYTPP1625E).
--    Only runs while the client still has zero transactions.
-- =====================================================================

DO $$
DECLARE
  v_client uuid := 'b4ffff5c-3d86-42e1-b8a0-4b1a33d7d880';
  v_txns   int;
  v_removed int;
BEGIN
  SELECT count(*) INTO v_txns FROM nw_transactions WHERE client_id = v_client;
  IF v_txns > 0 THEN
    RAISE NOTICE 'PURUSHOTHAMAN now has % transaction(s) — skipping orphan cleanup.', v_txns;
    RETURN;
  END IF;

  DELETE FROM nw_holdings
   WHERE client_id = v_client
     AND id IN (
       '33f62141-d32b-4a8b-80f6-4033a28c1ca7',  -- NSE, ₹20,00,000
       '7e133f95-bcce-4bde-962d-c4520e94068a'   -- akara capital, ₹5,08,000
     );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  PERFORM nw_recompute_portfolio_value(v_client);

  RAISE NOTICE 'Removed % orphaned holding(s) for PURUSHOTHAMAN; portfolio_value recomputed.', v_removed;
END $$;
