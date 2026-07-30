/*
  # Fix MAS FINANCIAL SERVICES LTD sell entry (the June MIS negative)

  Transaction 8ab8b946-4afe-4d14-8198-f8b66dab680c
  SAMBANDAM VEDACHALAM CHANDRASEKAR (NW-007-0003), 24 Jun 2026, SELL, qty 10,
  deal DC-1782278007563.

  This is the first and only SELL in the system, and the price fields were filled
  in with BUY habits: each rung was entered as a DEAL TOTAL rather than a
  per-unit rate (10x), and the ladder was ordered client-high/landing-low, which
  is the buy ordering.

  On a sell the ordering is reversed — the client is paid least, Niyom realises
  most:

    MIS  (MIS.tsx):      revenue = (landing_cost - dsa_price)   x qty
    DSA  (DSAPayout.tsx): payout  = (dsa_price    - client_price) x qty

  With the buy ordering in place, MIS computed (970590 - 980590) x 10 =
  -Rs.1,00,000, which single-handedly dragged June 2026 negative.

  Owner-confirmed per-unit rates for this trade:
    client price 97,059   (matches deal base_rate; settlement Rs.9,70,590)
    dsa price    98,059
    our price    99,059   (Niyom's onward realisation -> landing_cost)

  After this:
    MIS revenue = (99,059 - 98,059) x 10 = +Rs.10,000
    DSA payout  = (98,059 - 97,059) x 10 = +Rs.10,000

  NOTE: that DSA payout is genuinely new. This transaction was not covered by
  DN-2026-06-0001 (Rs.13,184, signed + paid 26 Jun 2026), so Rs.10,000 will now
  surface as an uncovered June payout for this DSA and needs a supplementary
  debit note.

  per_unit_price (97,059) was already correct and is left alone. The row is
  transferred, so the post-transfer immutability guard is lifted for the
  price-field correction.
*/

BEGIN;

ALTER TABLE nw_transactions DISABLE TRIGGER trg_nw_check_txn_post_transfer_immutable;

UPDATE nw_transactions
   SET client_price = 97059,
       dsa_price    = 98059,
       landing_cost = 99059
 WHERE id = '8ab8b946-4afe-4d14-8198-f8b66dab680c';

ALTER TABLE nw_transactions ENABLE TRIGGER trg_nw_check_txn_post_transfer_immutable;

DO $$
DECLARE r record; mis numeric; payout numeric;
BEGIN
  SELECT quantity, per_unit_price, client_price, dsa_price, landing_cost, txn_type
    INTO r FROM nw_transactions
   WHERE id = '8ab8b946-4afe-4d14-8198-f8b66dab680c';

  IF r IS NULL THEN RAISE EXCEPTION 'MAS transaction not found.'; END IF;

  mis    := (r.landing_cost - r.dsa_price)   * r.quantity;
  payout := (r.dsa_price    - r.client_price) * r.quantity;

  IF r.txn_type <> 'sell' THEN RAISE EXCEPTION 'Expected a sell, got %.', r.txn_type; END IF;
  IF mis    <> 10000 THEN RAISE EXCEPTION 'MIS revenue is %, expected 10000.', mis; END IF;
  IF payout <> 10000 THEN RAISE EXCEPTION 'DSA payout is %, expected 10000.', payout; END IF;
  IF r.per_unit_price <> 97059 THEN RAISE EXCEPTION 'per_unit_price changed (%).', r.per_unit_price; END IF;

  RAISE NOTICE 'MAS sell corrected: MIS +10000, DSA payout +10000.';
END $$;

COMMIT;
