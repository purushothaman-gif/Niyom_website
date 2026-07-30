/*
  # Link KALPATHY's 5 Jun NSE transaction to its deal confirmation

  KALPATHY GOPALAKRISHNAN YEGNESHWARAN (NW-003-0005) has two records for one
  piece of business, which never got joined:

    deal  75a9ab4c  DC-NIYOM-003-001  5 Jun 2026  NSE  25 @ 2010  fully_paid
    txn   ca5b4c6c                    5 Jun 2026  NSE  25 @ 2010  landing 1970

  Same client, same date, same quantity, same rate — one deal, one transaction.
  The transaction was entered directly rather than through Deal Confirmation ->
  Transfer Queue, so it carried neither deal_confirmation_id nor transfer_stage.
  MIS gates landing-cost revenue on one of those two being present (that gate is
  what stops pre-existing portfolio positions being reported as new revenue), so:

    * the transaction's real Rs.1,000 revenue was skipped, and
    * the deal separately showed as "Paid, awaiting booking" at Rs.0.

  Joining them collapses both symptoms into one correctly counted entry:
  June 2026 MIS Rs.75,441.93 -> Rs.76,441.93, with no pending or phantom rows
  left in the month.

  The deal's email_status is 'pending' only because the confirmation was
  generated in the CRM and emailed manually instead of via auto-send. That is
  normal practice here, does not affect MIS, and is left untouched.

  Owner-approved 2026-07-30. transferred_by/at are attributed to the deal's own
  employee (VINITHA G, NIYOM-003) and the deal date, since this is a
  reconciliation of business that completed then. No trigger needs lifting: the
  post-transfer immutability guard only fires when the row was ALREADY
  transferred, and this one was not.

  Client is direct-sourced, so DSA payout is unaffected.
*/

BEGIN;

UPDATE nw_transactions
   SET deal_confirmation_id = '75a9ab4c-81ad-4b55-843d-e5d295c5538e',
       transfer_stage       = 'transferred',
       transferred_at       = COALESCE(transferred_at, '2026-06-05 11:02:04.365952+00'),
       transferred_by       = COALESCE(transferred_by, '3f85a2a4-5119-4c0a-8cad-805aacdae866'),
       transfer_remarks     = COALESCE(transfer_remarks,
                                'Linked to DC-NIYOM-003-001 during Jun-2026 MIS reconciliation.'),
       updated_at           = now()
 WHERE id = 'ca5b4c6c-14b6-4566-9a8c-6ef0f454c9fc'
   AND deal_confirmation_id IS NULL;

DO $$
DECLARE v int; rev numeric;
BEGIN
  SELECT count(*) INTO v FROM nw_transactions
   WHERE id = 'ca5b4c6c-14b6-4566-9a8c-6ef0f454c9fc'
     AND deal_confirmation_id = '75a9ab4c-81ad-4b55-843d-e5d295c5538e'
     AND transfer_stage = 'transferred';
  IF v <> 1 THEN RAISE EXCEPTION 'Kalpathy transaction not linked (%).', v; END IF;

  -- Exactly one transaction may claim this deal.
  SELECT count(*) INTO v FROM nw_transactions
   WHERE deal_confirmation_id = '75a9ab4c-81ad-4b55-843d-e5d295c5538e';
  IF v <> 1 THEN RAISE EXCEPTION 'Deal claimed by % transactions, expected 1.', v; END IF;

  SELECT (per_unit_price - landing_cost) * quantity INTO rev
    FROM nw_transactions WHERE id = 'ca5b4c6c-14b6-4566-9a8c-6ef0f454c9fc';
  IF rev <> 1000 THEN RAISE EXCEPTION 'Expected Rs.1000 revenue, got %.', rev; END IF;

  RAISE NOTICE 'Kalpathy NSE transaction linked to DC-NIYOM-003-001 (+Rs.1,000 June).';
END $$;

COMMIT;
