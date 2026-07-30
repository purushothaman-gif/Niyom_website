/*
  # Auto-link a new transaction to its deal confirmation on entry

  Root-cause fix for the pattern reconciled six times on 2026-07-30
  (20260730120000 .. 20260730180000). Business gets entered straight into
  Transactions instead of flowing through Deal Confirmation -> Transfer Queue,
  so the transaction carries no deal_confirmation_id. MIS gates landing-cost
  revenue on `transfer_stage = 'transferred' OR deal_confirmation_id IS NOT NULL`,
  so the revenue is silently skipped, and once the deal's payment is recorded the
  deal ALSO renders as a Rs.0 "Paid, awaiting booking" row — one piece of
  business, shown twice, counted zero times.

  Doing this as a BEFORE INSERT trigger rather than in the UI covers every entry
  path at once. There are two: the manual form (Transactions.tsx) and the
  Transfer Queue RPC / transfer-deal edge function. The RPC already sets the link
  explicitly, and this trigger never touches a row that arrives with one.

  MATCHING RULES — deliberately conservative. A wrong link is worse than no
  link, because it would attribute one client's business to another deal.

    * Same client, deal status 'confirmed', same direction (Buy/Sell), same
      quantity.
    * The deal must not already be claimed by another transaction. (The partial
      unique index uq_nw_transactions_deal enforces one transaction per deal
      anyway; excluding claimed deals here means an innocent manual entry gets a
      clean insert instead of a 23505 violation.)
    * Two-stage rate matching: first require the deal rate to match the entered
      per-unit price; only if that finds nothing, fall back to quantity alone.
      Both stages link ONLY on an unambiguous single candidate — two candidates
      means we cannot tell which deal this is, so we link neither and behaviour
      is exactly as it is today.
    * Security NAME is deliberately NOT compared. Real data holds "MSEI" vs
      "METROPOLITAN STOCK EXCHANGE OF INDIA LIMITED" and "ESAF SMALL" vs
      "ESAF SAMALL" for the same security, so name matching would miss the very
      cases this exists to catch.

  WHAT IT DOES NOT DO: it never sets transfer_stage. The deal link alone is
  enough for MIS to count the revenue, and claiming 'transferred' would assert a
  demat transfer that has not happened. It would also arm
  trg_nw_txn_delete_cascade_deal, which deletes the deal and its payment history
  when a transferred, deal-linked transaction is removed. The Transfer Queue
  remains the only thing that marks a row transferred.

  Verified against all six reconciled cases: every one matches on stage 1
  (base_rate = per_unit_price), so had this existed they would all have linked
  themselves on entry.

  Exercised against the live schema with a synthetic deal + transaction inside an
  aborted transaction (nothing persisted). All six behaviours confirmed:
    T1 qty+rate match, security name deliberately different -> linked, stage NULL
    T2 explicit deal_confirmation_id (Transfer Queue path)  -> left untouched
    T3 two equally plausible candidates                     -> linked neither
    T4 direction mismatch (sell vs Buy deal)                -> not linked
    T5 mutual_fund                                          -> not linked
    T6 rate differs, quantity unique                        -> linked via stage 2
*/

CREATE OR REPLACE FUNCTION public.nw_txn_autolink_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids     uuid[];
  v_deal_id uuid;
  v_number  text;
BEGIN
  -- Respect an explicit link (Transfer Queue path) and skip products that carry
  -- no landing-cost revenue.
  IF NEW.deal_confirmation_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.product_type IS NULL
     OR NEW.product_type NOT IN ('unlisted_share','secondary_bond','primary_bond')
  THEN RETURN NEW; END IF;
  IF NEW.client_id IS NULL OR NEW.quantity IS NULL OR NEW.txn_type IS NULL
  THEN RETURN NEW; END IF;

  -- Stage 1: quantity AND rate must agree.
  -- array_agg, not min(): there is no min(uuid) in Postgres.
  SELECT array_agg(d.id) INTO v_ids
    FROM nw_deal_confirmations d
   WHERE d.client_id = NEW.client_id
     AND d.status = 'confirmed'
     AND d.quantity = NEW.quantity
     AND lower(d.transaction_type) = lower(NEW.txn_type)
     AND NEW.per_unit_price IS NOT NULL
     AND (d.base_rate = NEW.per_unit_price OR d.rate_per_unit = NEW.per_unit_price)
     AND NOT EXISTS (
           SELECT 1 FROM nw_transactions t WHERE t.deal_confirmation_id = d.id);

  -- Stage 2: quantity alone, only if the stricter pass found nothing.
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    SELECT array_agg(d.id) INTO v_ids
      FROM nw_deal_confirmations d
     WHERE d.client_id = NEW.client_id
       AND d.status = 'confirmed'
       AND d.quantity = NEW.quantity
       AND lower(d.transaction_type) = lower(NEW.txn_type)
       AND NOT EXISTS (
             SELECT 1 FROM nw_transactions t WHERE t.deal_confirmation_id = d.id);
  END IF;

  -- Unambiguous single candidate only.
  IF v_ids IS NOT NULL AND cardinality(v_ids) = 1 THEN
    v_deal_id := v_ids[1];
    NEW.deal_confirmation_id := v_deal_id;
    SELECT confirmation_number INTO v_number
      FROM nw_deal_confirmations WHERE id = v_deal_id;
    IF NEW.transfer_remarks IS NULL OR btrim(NEW.transfer_remarks) = '' THEN
      NEW.transfer_remarks := 'Auto-linked on entry to ' || COALESCE(v_number, 'its deal confirmation') || '.';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_nw_txn_autolink_deal ON public.nw_transactions;
CREATE TRIGGER trg_nw_txn_autolink_deal
  BEFORE INSERT ON public.nw_transactions
  FOR EACH ROW EXECUTE FUNCTION public.nw_txn_autolink_deal();

COMMENT ON FUNCTION public.nw_txn_autolink_deal() IS
  'Attaches a newly entered transaction to its matching unclaimed deal confirmation (same client, direction, quantity, and rate) so MIS counts its revenue and the deal stops showing as "awaiting booking". Links only on an unambiguous single match. Never sets transfer_stage.';
