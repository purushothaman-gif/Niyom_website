/*
  # Link TARLANA KAMARAJU's MSEI transaction to its deal confirmation

  The last known instance of the unlinked-transaction pattern, and the oldest —
  surfaced by the all-time assertion in 20260730124000, which is why it was
  found at all. Same shape as the five reconciled there: business entered
  directly as a transaction instead of flowing through Deal Confirmation ->
  Transfer Queue, so it carried neither deal_confirmation_id nor transfer_stage.
  MIS therefore skipped its revenue while the fully-paid deal separately
  displayed as "Paid, awaiting booking" at Rs.0.

    client  NW-007-0001  TARLANA KAMARAJU (direct-sourced)
    deal    36c0a178  DC-NIYOM-007-001  26 May 2026  MSEI 10,000 @ 6.10  fully_paid
    txn     6ffe1d79                     7 May 2026  MSEI 10,000 @ 6.10, landing 5.65

  Unambiguous pairing: this client has exactly one transaction and exactly one
  deal confirmation, with matching quantity and rate, and no transaction claimed
  the deal already.

  Revenue is (6.10 - 5.65) x 10,000 = Rs.4,500 and lands in MAY, since MIS dates
  landing-cost revenue by txn_date (7 May). Note the transaction predates its
  deal confirmation by 19 days — the reverse of the usual order — but quantity,
  rate and security all match and it is the client's only business, so the
  pairing is not in doubt.

  Direct-sourced, so DSA payout is unaffected. transferred_by is attributed to
  the deal's employee (PRABHU S), transferred_at to the transaction's own
  creation time. No trigger needs lifting: the row was not already transferred.
*/

BEGIN;

UPDATE nw_transactions
   SET deal_confirmation_id = '36c0a178-2275-49bd-bc1c-4f52e0b29f87',
       transfer_stage       = 'transferred',
       transferred_at       = COALESCE(transferred_at, created_at),
       transferred_by       = COALESCE(transferred_by, '418a9324-8f16-4560-ac11-ba84b05744a9'),
       transfer_remarks     = COALESCE(transfer_remarks,
                                'Linked to DC-NIYOM-007-001 during 2026-07-30 MIS reconciliation.'),
       updated_at           = now()
 WHERE id = '6ffe1d79-1114-4c52-b052-4cb57b1f5dcc'
   AND deal_confirmation_id IS NULL;

DO $$
DECLARE v int; rev numeric;
BEGIN
  SELECT count(*) INTO v FROM nw_transactions
   WHERE id = '6ffe1d79-1114-4c52-b052-4cb57b1f5dcc'
     AND deal_confirmation_id = '36c0a178-2275-49bd-bc1c-4f52e0b29f87'
     AND transfer_stage = 'transferred';
  IF v <> 1 THEN RAISE EXCEPTION 'TARLANA transaction not linked (%).', v; END IF;

  SELECT (per_unit_price - landing_cost) * quantity INTO rev
    FROM nw_transactions WHERE id = '6ffe1d79-1114-4c52-b052-4cb57b1f5dcc';
  IF rev <> 4500 THEN RAISE EXCEPTION 'Expected Rs.4500 revenue, got %.', rev; END IF;

  -- No deal may be claimed by more than one transaction.
  SELECT count(*) INTO v FROM (
    SELECT deal_confirmation_id FROM nw_transactions
     WHERE deal_confirmation_id IS NOT NULL
     GROUP BY deal_confirmation_id HAVING count(*) > 1) x;
  IF v <> 0 THEN RAISE EXCEPTION '% deal(s) claimed by multiple transactions.', v; END IF;

  -- With this one done, NO fully-paid landing-cost deal should be unbooked, in
  -- any month. This assertion is deliberately unscoped now — if it ever fails
  -- again it means a fresh instance of the pattern has appeared.
  SELECT count(*) INTO v
    FROM nw_deal_confirmations d
    JOIN nw_deal_payment_summary s ON s.deal_id = d.id AND s.payment_status = 'fully_paid'
   WHERE d.product_type IN ('Unlisted Share','Secondary Bond','Primary Bond')
     AND NOT EXISTS (SELECT 1 FROM nw_transactions t WHERE t.deal_confirmation_id = d.id);
  IF v <> 0 THEN RAISE EXCEPTION '% fully-paid deal(s) still unbooked.', v; END IF;

  RAISE NOTICE 'TARLANA MSEI transaction linked (+Rs.4,500 May). No unbooked paid deals remain.';
END $$;

COMMIT;
