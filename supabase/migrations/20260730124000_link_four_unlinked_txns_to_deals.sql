/*
  # Link four more unlinked transactions to their deal confirmations

  Same reconciliation as 20260730123000 (KALPATHY). These four deals were all
  'not_paid' earlier on 2026-07-30 and had their payments recorded during the
  day, which promoted them into the MIS "paid but not booked" branch — where
  they showed as Rs.0 "Paid, awaiting booking" rows while their real revenue sat
  in an unlinked transaction that MIS skipped. One piece of business appearing
  twice and counted zero times.

  Each pairing is unambiguous: the client has exactly one transaction and one
  deal confirmation, quantity and rate match, and no transaction claimed the
  deal already.

    client        deal                 txn date   qty    rate    landing  revenue  lands in
    NW-002-0003   DC-1782295332142     25 Jun     1180   2085    2070     17,700   June
    NW-001-0002   DC-1782386596488     29 Jun     1000   2073*   2065      8,000   June
    NW-002-0004   DC-1782822836437      1 Jul     1000    235     228      7,000   July
    NW-002-0005   DC-1782825887702      1 Jul     1000    235     228      7,000   July

    * SRIRAM NAGARAJAN is DSA-sourced, so MIS prices at dsa_price (2073), not
      per_unit_price (2095). His transaction is ALREADY on an active debit note
      (Rs.22,000 payout), so linking creates no new DSA liability. The other
      three are direct-sourced.

  The two Hinduja deals are dated 30 Jun but booked 1 Jul — normal month-end
  behaviour. Their revenue therefore lands in JULY, and thanks to the
  booked-ever fix in MIS.tsx they no longer echo back into June as phantom
  "awaiting booking" rows.

  Expected after this: June 2026 Rs.76,441.93 -> Rs.1,02,141.93,
  July 2026 Rs.1,00,841.50 -> Rs.1,14,841.50, and no fully-paid June or July
  deal left without a booking.

  NOT INCLUDED — one older instance of the same pattern remains, deliberately
  left for the owner to decide on:
    NW-007-0001  TARLANA KAMARAJU  DC-NIYOM-007-001  26 May 2026
    txn 6ffe1d79  7 May 2026  MSEI 10,000 @ 6.10, landing 5.65  =  Rs.4,500 (May)
  Hence the final assertion below is scoped to June/July rather than all time.

  transferred_by is attributed to each deal's own employee; transferred_at to the
  transaction's own creation time, since that is when the booking actually
  happened. No trigger needs lifting — none of these rows was already
  transferred, so the post-transfer immutability guard does not fire.
*/

BEGIN;

CREATE TEMP TABLE _links (txn_id uuid, deal_id uuid, emp_id uuid) ON COMMIT DROP;
INSERT INTO _links VALUES
  ('97e7ac79-4d95-45d2-b9fe-3382304a57b7', 'a217a4fe-84cd-4127-8f07-3c0ff878a949', '456c51c0-8b7d-47a5-9af3-e042e9f5460d'),
  ('f730e3bf-897d-4747-b41b-4afbf2d77642', 'dd672cce-4478-41de-916a-ef25df17e677', '1b543112-3251-4912-847b-92982f2de563'),
  ('ee7167b9-135f-4780-9900-bcc1a54360e7', 'aacad7e6-6394-4f33-9209-51641d95b595', '456c51c0-8b7d-47a5-9af3-e042e9f5460d'),
  ('2153ac14-d21f-4d83-80e4-132f314f3756', 'b0d77867-5a89-48cf-a2e0-eda996bcf874', '456c51c0-8b7d-47a5-9af3-e042e9f5460d');

UPDATE nw_transactions t
   SET deal_confirmation_id = l.deal_id,
       transfer_stage       = 'transferred',
       transferred_at       = COALESCE(t.transferred_at, t.created_at),
       transferred_by       = COALESCE(t.transferred_by, l.emp_id),
       transfer_remarks     = COALESCE(t.transfer_remarks,
                                'Linked to its deal confirmation during Jun/Jul-2026 MIS reconciliation.'),
       updated_at           = now()
  FROM _links l
 WHERE t.id = l.txn_id
   AND t.deal_confirmation_id IS NULL;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM nw_transactions t JOIN _links l ON l.txn_id = t.id
   WHERE t.deal_confirmation_id = l.deal_id AND t.transfer_stage = 'transferred';
  IF v <> 4 THEN RAISE EXCEPTION 'Only % of 4 transactions linked.', v; END IF;

  -- No deal may be claimed by more than one transaction.
  SELECT count(*) INTO v FROM (
    SELECT deal_confirmation_id FROM nw_transactions
     WHERE deal_confirmation_id IS NOT NULL
     GROUP BY deal_confirmation_id HAVING count(*) > 1) x;
  IF v <> 0 THEN RAISE EXCEPTION '% deal(s) claimed by multiple transactions.', v; END IF;

  -- Every fully-paid Jun/Jul landing-cost deal must now have a booking. Scoped
  -- to those two months on purpose: the May TARLANA KAMARAJU deal noted above
  -- is a known remaining instance and is out of scope for this migration.
  SELECT count(*) INTO v
    FROM nw_deal_confirmations d
    JOIN nw_deal_payment_summary s ON s.deal_id = d.id AND s.payment_status = 'fully_paid'
   WHERE d.product_type IN ('Unlisted Share','Secondary Bond','Primary Bond')
     AND d.deal_date BETWEEN '2026-06-01' AND '2026-07-31'
     AND NOT EXISTS (SELECT 1 FROM nw_transactions t WHERE t.deal_confirmation_id = d.id);
  IF v <> 0 THEN RAISE EXCEPTION '% fully-paid Jun/Jul deal(s) still unbooked.', v; END IF;

  RAISE NOTICE 'Four transactions linked: +Rs.25,700 June, +Rs.14,000 July.';
END $$;

COMMIT;
