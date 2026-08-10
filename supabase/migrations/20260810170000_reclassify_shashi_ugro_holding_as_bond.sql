/*
  # Reclassify SHASHI GUPTA's UGRO CAPITAL LTD holding as a secondary bond

  Last item from the 20260810160000 sweep. The position was never missing — the
  holding and its transaction agree on name, ISIN (INE583D08081), quantity (5)
  and amount (Rs.5,07,048). They disagreed only on product_type: the holding said
  unlisted_share, the transaction said secondary_bond.

  The transaction is right. ISIN INE583D08081 carries the '08' series that marks
  a debenture rather than equity, and the holding itself already carries
  payout_frequency 'annual' and a client_price — fields only a bond would have.
  It was always meant to be a bond; the type was simply wrong.

  NO VALUE CHANGES. This matters because the two product types are valued
  differently by syncTransactionToHolding / nw_apply_txn_holding /
  nw_unwind_txn_holding: a secondary_bond uses client_price x quantity where
  other types use consolidated_amount. Here they coincide exactly —
  101,409.6 x 5 = 5,07,048 = the stored consolidated_amount and invested_amount —
  so switching the type introduces no drift in either direction.

  It also FIXES a latent hazard. Those helpers match a holding on
  (client_id, product_type, normalised product_name). While the types disagreed,
  the transaction could not find its own holding: deleting or editing it would
  have silently no-opped, orphaning the position (the 2026-07-25 PURUSHOTHAMAN
  failure mode). After this they match, so unwind works.

  issuer_name is filled in from the security name, which is a plain restatement
  of what the row already says and matches how the other bond holdings are
  populated. face_value, coupon_rate and maturity_date are LEFT NULL — that data
  is not in any record here and will not be invented; they need entering by hand
  for the position to display complete bond details.
*/

BEGIN;

UPDATE nw_holdings h
   SET product_type = 'secondary_bond',
       issuer_name  = COALESCE(NULLIF(btrim(h.issuer_name), ''), 'UGRO CAPITAL LTD'),
       updated_at   = now()
  FROM nw_clients c
 WHERE c.id = h.client_id
   AND c.client_code = 'NW-006-0003'
   AND h.product_type = 'unlisted_share'
   AND h.isin = 'INE583D08081';

DO $$
DECLARE n int; q numeric; inv numeric; pv numeric; t text;
BEGIN
  SELECT count(*), max(h.quantity), max(h.invested_amount), max(h.product_type)
    INTO n, q, inv, t
    FROM nw_holdings h JOIN nw_clients c ON c.id = h.client_id
   WHERE c.client_code = 'NW-006-0003';
  IF n <> 1 THEN RAISE EXCEPTION 'Expected 1 holding for NW-006-0003, got %.', n; END IF;
  IF t <> 'secondary_bond' THEN RAISE EXCEPTION 'product_type is %, expected secondary_bond.', t; END IF;
  IF q <> 5 THEN RAISE EXCEPTION 'Quantity changed: %.', q; END IF;
  IF inv <> 507048 THEN RAISE EXCEPTION 'Invested changed: %, expected 507048.', inv; END IF;

  SELECT portfolio_value INTO pv FROM nw_clients WHERE client_code = 'NW-006-0003';
  IF pv <> 507048 THEN RAISE EXCEPTION 'portfolio_value %, expected 507048.', pv; END IF;

  -- The transaction can now find its own holding.
  SELECT count(*) INTO n
    FROM nw_transactions x
    JOIN nw_clients c ON c.id = x.client_id
    JOIN nw_holdings h ON h.client_id = x.client_id
     AND h.product_type = x.product_type
     AND lower(btrim(h.product_name)) = lower(btrim(x.product_name))
   WHERE c.client_code = 'NW-006-0003';
  IF n <> 1 THEN RAISE EXCEPTION 'Transaction still cannot match its holding (%).', n; END IF;

  -- And the whole sweep is now clean: no BUY anywhere lacks a holding.
  SELECT count(*) INTO n
    FROM nw_transactions x
   WHERE x.txn_type = 'buy'
     AND NOT EXISTS (SELECT 1 FROM nw_holdings h
                      WHERE h.client_id = x.client_id
                        AND h.product_type = x.product_type
                        AND lower(btrim(h.product_name)) = lower(btrim(x.product_name)));
  IF n <> 0 THEN RAISE EXCEPTION '% buy transaction(s) still without a holding.', n; END IF;

  RAISE NOTICE 'UGRO holding reclassified as secondary_bond; every buy now has a matching holding.';
END $$;

COMMIT;
