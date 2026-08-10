/*
  # Put a Transfer-Queue-created booking into the client's portfolio

  Closes the last gap in the "why isn't it in the portfolio" story. Nothing in
  the transfer chain ever wrote a holding — TransferQueue.tsx, the transfer-deal
  edge function and nw_transfer_deal all leave nw_holdings alone — so a deal
  transferred WITHOUT first being keyed into the Transactions form never reached
  the portfolio. Only two client-side paths create holdings
  (syncTransactionToHolding, and manual entry in Portfolio.tsx), and neither runs
  on a transfer.

  WHY A TRIGGER, AND WHY IT CANNOT DOUBLE-COUNT

  nw_transfer_deal has two branches, and they are an exact discriminator:

    v_pending_txn.id IS NOT NULL -> UPDATEs a transaction the operator already
      booked through Add New Business. That form ran syncTransactionToHolding on
      insert, so the holding ALREADY EXISTS and must not be added to again.

    ELSE -> INSERTs a brand-new transaction built from the deal. Nothing has ever
      applied this transaction to a holding, so one must be created.

  An AFTER INSERT trigger gated on transfer_stage = 'transferred' fires for the
  second branch only:
    * the manual form sets transfer_stage: null explicitly on insert
      (Transactions.tsx: "Transfer Queue is the sole transfer point"), so a row
      INSERTED already-transferred can only have come from the RPC;
    * the UPDATE branch is an UPDATE, so an INSERT trigger never sees it.

  nw_apply_txn_holding mirrors syncTransactionToHolding exactly, and matches
  holdings the same way nw_unwind_txn_holding does — exact product_type, and
  product_name compared case- and whitespace-insensitively, preferring the most
  recently touched row. If the client already holds the security it merges with a
  weighted average rather than creating a second row.

  Buys only, like both of its siblings: a sell has no holding to create.
*/

CREATE OR REPLACE FUNCTION public.nw_apply_txn_holding(p_txn nw_transactions)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_amount  numeric;
  v_price   numeric;
  v_hold    nw_holdings%ROWTYPE;
  v_new_qty numeric;
  v_new_inv numeric;
BEGIN
  IF p_txn.txn_type <> 'buy' THEN
    RETURN;
  END IF;

  -- Secondary bonds invest client_price x qty; consolidated_amount carries the
  -- firm's acquisition total for those. Everything else uses consolidated_amount.
  v_amount := CASE
    WHEN p_txn.product_type = 'secondary_bond' AND p_txn.client_price IS NOT NULL
      THEN p_txn.client_price * COALESCE(p_txn.quantity, 0)
    ELSE COALESCE(p_txn.consolidated_amount, 0)
  END;
  v_price := COALESCE(p_txn.per_unit_price, 0);

  IF COALESCE(p_txn.quantity, 0) <= 0 OR v_amount <= 0 THEN
    RETURN;  -- nothing meaningful to record
  END IF;

  SELECT * INTO v_hold
    FROM nw_holdings
   WHERE client_id    = p_txn.client_id
     AND product_type = p_txn.product_type
     AND lower(btrim(product_name)) = lower(btrim(p_txn.product_name))
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  IF FOUND THEN
    -- Weighted average into the existing position.
    v_new_qty := COALESCE(v_hold.quantity, 0)        + COALESCE(p_txn.quantity, 0);
    v_new_inv := COALESCE(v_hold.invested_amount, 0) + v_amount;
    UPDATE nw_holdings
       SET quantity        = v_new_qty,
           invested_amount = v_new_inv,
           avg_cost        = CASE WHEN v_new_qty > 0 THEN v_new_inv / v_new_qty ELSE v_price END,
           current_value   = v_new_inv,
           isin            = COALESCE(NULLIF(p_txn.isin, ''), v_hold.isin),
           updated_at      = now()
     WHERE id = v_hold.id;
  ELSE
    INSERT INTO nw_holdings (
      client_id, product_type, product_name, txn_date, isin,
      quantity, avg_cost, invested_amount, current_value,
      landing_cost, dsa_price, client_price, notes
    ) VALUES (
      p_txn.client_id, p_txn.product_type, p_txn.product_name, p_txn.txn_date,
      NULLIF(p_txn.isin, ''),
      p_txn.quantity, v_price, v_amount, v_amount,
      p_txn.landing_cost, p_txn.dsa_price, p_txn.client_price,
      'Created from Transfer Queue booking.'
    );
  END IF;

  PERFORM nw_recompute_portfolio_value(p_txn.client_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.nw_txn_apply_holding_on_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM nw_apply_txn_holding(NEW);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_nw_txn_apply_holding_on_transfer ON public.nw_transactions;
CREATE TRIGGER trg_nw_txn_apply_holding_on_transfer
  AFTER INSERT ON public.nw_transactions
  FOR EACH ROW
  WHEN (NEW.transfer_stage = 'transferred' AND NEW.txn_type = 'buy')
  EXECUTE FUNCTION public.nw_txn_apply_holding_on_transfer();

COMMENT ON FUNCTION public.nw_apply_txn_holding(nw_transactions) IS
  'Applies a BUY transaction to the client''s holding (weighted-average merge, or a new row) and recomputes portfolio_value. The inverse of nw_unwind_txn_holding, and the SQL mirror of syncTransactionToHolding in Transactions.tsx.';
COMMENT ON FUNCTION public.nw_txn_apply_holding_on_transfer() IS
  'Fires only for a transaction INSERTED already transfer_stage=transferred, which can only come from nw_transfer_deal''s create branch. The manual form always inserts transfer_stage null and syncs its own holding, and the RPC''s other branch is an UPDATE, so this cannot double-count.';
