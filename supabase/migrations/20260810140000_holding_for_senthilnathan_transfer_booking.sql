/*
  # Create the missing holding for SENTHILNATHAN ANNAMALAI (NW-001-0013)

  Business booked 2026-08-10 for INDUSIND GENERAL INSURANCE COMPANY LIMITED
  (100 @ 555, settlement 55,500, txn 67475afc) showed nothing in Portfolio,
  because no holding row was ever created for it.

  WHY: the booking went through the Transfer Queue, and nothing in that chain
  creates a holding. TransferQueue.tsx -> transfer-deal edge function ->
  nw_transfer_deal RPC: none of the three touches nw_holdings (verified against
  the live function body and both source files). Only two code paths in the whole
  app ever insert a holding:

    src/crm/Transactions.tsx  (syncTransactionToHolding, on the manual form)
    src/crm/Portfolio.tsx     (manual holding entry)

  So a deal booked purely through the Transfer Queue records the transaction and
  the revenue, but never reaches the client's portfolio. Other transferred
  bookings only have holdings because the same business was ALSO keyed into the
  Transactions form or added by hand in Portfolio afterwards.

  This backfills the one row, mirroring syncTransactionToHolding exactly:
    avg_cost        = per_unit_price
    invested_amount = consolidated_amount   (client_price x qty for secondary
                                             bonds only; this is an unlisted share)
    current_value   = invested_amount        (the app's default until a market
                                             value is entered manually)

  Every value is read from the transaction rather than retyped. portfolio_value
  is then recomputed from the client's holdings, as in the earlier
  reconciliations.

  This does NOT change the pipeline — the next Transfer Queue booking will have
  the same gap. Fixing that is a separate decision, because operators currently
  double-enter through the Transactions form and auto-creating holdings on
  transfer would double their positions.
*/

BEGIN;

INSERT INTO nw_holdings (
  client_id, product_type, product_name, txn_date, isin,
  quantity, avg_cost, invested_amount, current_value,
  landing_cost, dsa_price, client_price, notes
)
SELECT t.client_id, t.product_type, t.product_name, t.txn_date, NULLIF(t.isin, ''),
       t.quantity,
       t.per_unit_price,
       t.consolidated_amount,
       t.consolidated_amount,
       t.landing_cost, t.dsa_price, t.client_price,
       'Backfilled 2026-08-10: booked via Transfer Queue, which does not create holdings.'
  FROM nw_transactions t
 WHERE t.id = '67475afc-b308-4a49-8e1c-cdc14d576818'
   AND NOT EXISTS (
     SELECT 1 FROM nw_holdings h
      WHERE h.client_id = t.client_id
        AND h.product_type = t.product_type
        AND h.product_name = t.product_name);

UPDATE nw_clients c
   SET portfolio_value = COALESCE(
         (SELECT SUM(h.current_value) FROM nw_holdings h WHERE h.client_id = c.id), 0)
 WHERE c.client_code = 'NW-001-0013';

DO $$
DECLARE v int; q numeric; val numeric; pv numeric;
BEGIN
  SELECT count(*), max(h.quantity), max(h.current_value)
    INTO v, q, val
    FROM nw_holdings h
    JOIN nw_clients c ON c.id = h.client_id
   WHERE c.client_code = 'NW-001-0013';
  IF v <> 1 THEN RAISE EXCEPTION 'Expected 1 holding for NW-001-0013, got %.', v; END IF;
  IF q <> 100 THEN RAISE EXCEPTION 'Expected qty 100, got %.', q; END IF;
  IF val <> 55500 THEN RAISE EXCEPTION 'Expected value 55500, got %.', val; END IF;

  SELECT portfolio_value INTO pv FROM nw_clients WHERE client_code = 'NW-001-0013';
  IF pv <> 55500 THEN RAISE EXCEPTION 'portfolio_value is %, expected 55500.', pv; END IF;

  RAISE NOTICE 'Holding created for NW-001-0013: 100 units, Rs.55,500.';
END $$;

COMMIT;
