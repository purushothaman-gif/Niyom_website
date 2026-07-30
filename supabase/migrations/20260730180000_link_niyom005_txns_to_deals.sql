/*
  # Link four more unlinked transactions to their deal confirmations

  Third batch of the same pattern (see 20260730123000, 20260730124000,
  20260730125000). These three did not appear in the earlier sweeps because
  their deals were still 'not_paid' at the time — the unscoped assertion in
  20260730125000 genuinely passed. Their payments were recorded later on
  2026-07-30, which promoted them into the MIS "paid but not booked" branch,
  where the owner found all three showing Rs.0 "Paid, awaiting booking" against
  employee BHUVANESWARI R (NIYOM-005) for June 2026.

  Each transaction carries the correct landing cost but neither
  deal_confirmation_id nor transfer_stage, so MIS skipped its revenue while the
  paid deal separately rendered as Rs.0 — one piece of business, shown twice,
  counted zero times.

  Every pairing is unambiguous: one transaction and one deal per client, with
  matching quantity and rate, and no transaction claimed the deal already.

    client        deal                txn date   qty     price   landing  revenue
    NW-005-0002   DC-NIYOM-005-001    3 Jun      150     155*    150        750
    NW-005-0003   DC-NIYOM-005-002    3 Jun      150     155*    150        750
    NW-005-0004   DC-1782215499515    23 Jun    1000      37.28   36      1,280

    NW-001-0001   DC-NIYOM-001-004    10 Jun       1  1009595  986596.89  22,998.11

    * PRADEEP ELAMURUGU and SUBRAMANIYAN HARIPRAVEEN are DSA-sourced, so MIS
      prices at dsa_price (155), not per_unit_price (160). RAJANAHALLI SAMARTH and
      VASUDEVAN SUGUNDHA are direct-sourced.

  The fourth row (VASUDEVAN SUGUNDHA, UGRO CAPITAL, employee NIYOM-001) was not
  on the owner's screen — they reported only the three NIYOM-005 clients. It was
  caught by the unscoped assertion below, which failed and rolled this migration
  back on the first attempt. It is the identical defect with the same remedy and
  by far the largest amount of the four, so it is included rather than left to be
  rediscovered later.

  DSA payout is unaffected: DSAPayout derives payouts from client_price/dsa_price
  and debit-note coverage, never from transfer_stage or the deal link. The two
  Rs.750 spreads here are the Rs.1,500 the owner reports already paid to DSA
  NAGARAJAN (NWDSA-005-001) on 27-Jun-2026.

  Expected after this: June 2026 Rs.1,02,141.93 -> Rs.1,27,920.04.

  transferred_by is attributed to each deal's own employee; transferred_at to the
  transaction's own creation time. No trigger needs lifting — none of these rows
  was already transferred.
*/

BEGIN;

CREATE TEMP TABLE _links (txn_id uuid, deal_id uuid, emp_id uuid) ON COMMIT DROP;
INSERT INTO _links VALUES
  ('8c774d0d-7be1-4029-b798-d54909d09274', '465ced8a-833a-4c55-b0ab-096d4039c22c', '141a9df2-f2a2-407d-b67c-0a51ea24a8b7'),
  ('d3e9a24c-c6a2-48a8-8804-ad393cf9edb9', '9b9bf455-0702-42fe-963f-038dd41f3bbd', '141a9df2-f2a2-407d-b67c-0a51ea24a8b7'),
  ('7dbed497-afa0-4c38-8c99-4c21e4b618b7', 'd71c80b4-290c-4a2c-8a73-d338e63a4ea5', '141a9df2-f2a2-407d-b67c-0a51ea24a8b7'),
  ('14710641-d62d-4cb6-91bc-b5fba206d759', '8ee591d1-4232-4ca6-85b5-92b49b3d244b', '1b543112-3251-4912-847b-92982f2de563');

UPDATE nw_transactions t
   SET deal_confirmation_id = l.deal_id,
       transfer_stage       = 'transferred',
       transferred_at       = COALESCE(t.transferred_at, t.created_at),
       transferred_by       = COALESCE(t.transferred_by, l.emp_id),
       transfer_remarks     = COALESCE(t.transfer_remarks,
                                'Linked to its deal confirmation during 2026-07-30 MIS reconciliation.'),
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

  -- Unscoped on purpose: no fully-paid landing-cost deal should be unbooked in
  -- any month. If this fails again, another deal's payment has landed since.
  SELECT count(*) INTO v
    FROM nw_deal_confirmations d
    JOIN nw_deal_payment_summary s ON s.deal_id = d.id AND s.payment_status = 'fully_paid'
   WHERE d.product_type IN ('Unlisted Share','Secondary Bond','Primary Bond')
     AND NOT EXISTS (SELECT 1 FROM nw_transactions t WHERE t.deal_confirmation_id = d.id);
  IF v <> 0 THEN RAISE EXCEPTION '% fully-paid deal(s) still unbooked.', v; END IF;

  RAISE NOTICE 'Four transactions linked (+Rs.25,778.11 June).';
END $$;

COMMIT;
