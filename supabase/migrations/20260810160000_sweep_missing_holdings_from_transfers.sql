/*
  # Sweep: restore holdings lost to Transfer-Queue bookings

  Backfill for the gap closed by 20260810150000. Before that trigger existed,
  nw_transfer_deal's create branch inserted a transaction but nothing ever wrote
  the holding, so any deal transferred WITHOUT first being keyed into the
  Transactions form left the client's portfolio short.

  A full sweep of every BUY transaction with no matching holding returned three
  rows. Only two are genuinely missing; the third is a classification difference
  and is deliberately left alone.

  1. ANSHUL BHARDWAJ (NW-002-0006) — DEEPAK HOUSEWARE & TOYS LIMITED,
     5000 @ 57.4914 = Rs.2,87,500, txn 3602fb80.
     Migration 20260722160000 reversed an accidental Add-New-Business booking,
     deleting both the transaction and its holding so the deal would return to
     the Transfer Queue. It was then properly re-transferred on 2026-07-23
     05:42:41 (created_at = transferred_at, the RPC's create branch) — and the
     holding never came back, because that path wrote none. Client currently has
     ZERO holdings.

  2. AMBIKA A GUNNAM (NW-003-0001) — SBI, 100 @ 860 = Rs.86,000, txn 9fe5290c,
     likewise created by the transfer on 2026-07-23 06:03:18.
     This one must MERGE, not create: she already holds 500 units from txn
     179ef777 (May, entered through the form). The two carry the SAME ISIN,
     INE640G01020 — the same security recorded under two names, "SBI MF" on the
     older record and "SBI Fund Management Ltd" on the newer.

     Both names are canonicalised to "SBI Fund Management Ltd" FIRST, on the
     holding and on the May transaction. That matters beyond tidiness: holdings
     are matched by (client, product_type, normalised product_name), so leaving
     two spellings would (a) stop the merge below from finding the holding, and
     (b) leave the May transaction unable to unwind its own holding if it were
     ever edited or deleted. Renaming both keeps every record pointing at one row.
     Result: 600 units, Rs.4,62,500 invested, avg 770.8333.

  NOT FIXED — SHASHI GUPTA (NW-006-0003), UGRO CAPITAL LTD, 5 @ 101,409.6:
  this position IS in the portfolio. Holding and transaction agree on name, ISIN
  (INE583D08081), quantity and amount; they differ only in product_type — the
  holding says unlisted_share, the transaction says secondary_bond. The ISIN's
  '08' series marks it a debenture, so the transaction is right and the holding
  is misclassified. That is a reclassification decision affecting how the client
  sees the position (equity vs bond, and bond-specific fields it has none of),
  not a missing holding, so it is left for the owner. It will keep appearing in
  this sweep until reclassified.

  Both fixes go through nw_apply_txn_holding(), the same function the new trigger
  uses, so the arithmetic and portfolio_value recompute are identical to what a
  transfer would now do by itself.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- AMBIKA: canonicalise the security name so both records point at one holding.
-- ---------------------------------------------------------------------------
UPDATE nw_holdings
   SET product_name = 'SBI Fund Management Ltd', updated_at = now()
 WHERE client_id = (SELECT id FROM nw_clients WHERE client_code = 'NW-003-0001')
   AND product_type = 'unlisted_share'
   AND lower(btrim(product_name)) = 'sbi mf';

-- The May transaction is not transferred, so the immutability guard is not in play.
UPDATE nw_transactions
   SET product_name = 'SBI Fund Management Ltd', updated_at = now()
 WHERE id = '179ef777-1a04-4be5-a795-f4b107a6772c'
   AND lower(btrim(product_name)) = 'sbi mf';

-- ---------------------------------------------------------------------------
-- Apply the two orphaned transfer-created buys.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t nw_transactions%ROWTYPE;
BEGIN
  FOR t IN
    SELECT * FROM nw_transactions
     WHERE id IN ('3602fb80-0720-45f8-9cdf-2189da86498e',   -- ANSHUL   (creates)
                  '9fe5290c-ce91-43e1-b0d7-2d376c3941b8')   -- AMBIKA   (merges)
  LOOP
    PERFORM nw_apply_txn_holding(t);
  END LOOP;
END $$;

DO $$
DECLARE q numeric; inv numeric; n int; pv numeric;
BEGIN
  -- ANSHUL: a new holding for the full position.
  SELECT count(*), max(h.quantity), max(h.invested_amount) INTO n, q, inv
    FROM nw_holdings h JOIN nw_clients c ON c.id = h.client_id
   WHERE c.client_code = 'NW-002-0006';
  IF n <> 1 THEN RAISE EXCEPTION 'ANSHUL: expected 1 holding, got %.', n; END IF;
  IF q <> 5000 THEN RAISE EXCEPTION 'ANSHUL: expected qty 5000, got %.', q; END IF;
  IF inv <> 287500 THEN RAISE EXCEPTION 'ANSHUL: expected invested 287500, got %.', inv; END IF;

  -- AMBIKA: merged into ONE row, not a second one.
  SELECT count(*), max(h.quantity), max(h.invested_amount) INTO n, q, inv
    FROM nw_holdings h JOIN nw_clients c ON c.id = h.client_id
   WHERE c.client_code = 'NW-003-0001'
     AND lower(btrim(h.product_name)) = 'sbi fund management ltd';
  IF n <> 1 THEN RAISE EXCEPTION 'AMBIKA: expected 1 SBI holding, got %.', n; END IF;
  IF q <> 600 THEN RAISE EXCEPTION 'AMBIKA: expected qty 600, got %.', q; END IF;
  IF inv <> 462500 THEN RAISE EXCEPTION 'AMBIKA: expected invested 462500, got %.', inv; END IF;

  SELECT portfolio_value INTO pv FROM nw_clients WHERE client_code = 'NW-003-0001';
  IF pv <> 673000 THEN RAISE EXCEPTION 'AMBIKA: portfolio_value %, expected 673000.', pv; END IF;

  -- No BUY should be left without a holding except the known SHASHI one.
  SELECT count(*) INTO n
    FROM nw_transactions t
   WHERE t.txn_type = 'buy'
     AND NOT EXISTS (SELECT 1 FROM nw_holdings h
                      WHERE h.client_id = t.client_id
                        AND h.product_type = t.product_type
                        AND lower(btrim(h.product_name)) = lower(btrim(t.product_name)));
  IF n <> 1 THEN RAISE EXCEPTION 'Expected only the SHASHI type-mismatch left, found %.', n; END IF;

  RAISE NOTICE 'Sweep complete: ANSHUL restored, AMBIKA merged to 600 units.';
END $$;

COMMIT;
