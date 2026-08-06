/*
  # Recreate the deal confirmations for SANJAY GUPTA and PAYAL GARG

  Both clients have transferred HINDUJA LEYLAND FINANCE transactions dated
  3 Jul 2026 with no deal confirmation behind them. The confirmations are not
  merely unsigned — they do not exist.

  How they were lost: migration 20260723210000 deleted these two clients'
  earlier Hinduja transactions as re-entered duplicates. Deleting a transferred,
  deal-linked transaction fires trg_nw_txn_delete_cascade_deal, which removes the
  deal confirmation AND its payment rows. The transactions were then re-entered
  manually on 2026-07-23 12:06:36 without deals, so the paperwork never came back.

  This recreates them from the transactions themselves, which carry the agreed
  terms:

    NW-006-0005  PAYAL GARG    1000 @ 239.96  landing 228  settlement 2,39,960
    NW-006-0006  SANJAY GUPTA   500 @ 240.00  landing 230  settlement 1,20,000

  settlement_amount and stamp_duty are GENERATED columns
  (settlement = round(base_rate * quantity, 2)), so base_rate is set to the
  transaction's per-unit price and the settlement then reproduces each
  transaction's consolidated_amount exactly.

  acceptance_status stays 'pending': the owner confirms client signature is not a
  mandatory requirement here, and inventing an acceptance would be a false record.
  email_status likewise stays 'pending' — nothing has been sent for these.

  NUMBERING: nw_generate_confirmation_number() is deliberately NOT used. Its
  regex ('^DC-[^-]+-0*' then CAST to integer) cannot parse the epoch-style
  'DC-1782968891645' numbers this employee already has, so the function raises on
  the cast. DealConfirmation.tsx swallows that and falls back to
  `DC-${Date.now()}`, which is why NIYOM-006 carries both styles — and why the
  fault is self-perpetuating: one epoch number poisons every later call for that
  employee. These two take the next free sequential numbers by hand.

  The transactions are then linked, which is what stops the same business being
  reported twice. Note the consequence under payment-month recognition: with a
  deal attached but no payment recorded, these two now read Rs.0 "Awaiting
  payment" instead of contributing Rs.5,000 to July. That is the truthful
  position — no payment on record means no revenue recognised. Recording the
  payments (Deal Payments -> Manage Payments) restores the revenue into the month
  the money actually arrived.

  The post-transfer immutability guard is lifted only to attach the link.
*/

BEGIN;

INSERT INTO nw_deal_confirmations (
  id, confirmation_number, client_id, employee_id, status,
  deal_date, transaction_type, product_type, security_name, isin,
  quantity, rate_per_unit, base_rate, landing_cost,
  snap_client_name, snap_pan, snap_dp_name, snap_demat_account, snap_depository,
  snap_bank_name, snap_bank_account, snap_bank_ifsc,
  snap_address, snap_phone, snap_email,
  acceptance_status, email_status, notes
) VALUES
  (gen_random_uuid(), 'DC-NIYOM-006-003',
   'cb8f451c-3545-4053-9a23-4d15a868a402', '6561291d-d7fd-4b8a-80ba-7c54c4371dbe', 'confirmed',
   '2026-07-03', 'Buy', 'Unlisted Share', 'HINDUJA LEYLAND FINANCE', 'INE146O01014',
   1000, 239.96, 239.96, 228,
   'PAYAL GARG', 'AUFPG7608D', 'SMC GLOBAL SECURITIES LTD', '1201910000938174', 'CDSL',
   'YES BANK', '108051100000334', 'YESB0001080',
   'SHIVAM GUPTA FLAT D 1304 INDOSAM 75SECTOR 75 NOIDA GAUTAM BUDDHA NAGAR GHAZIABAD, 201301, UTTAR PRADESH, INDIA',
   '9783969195', 'payalgarg1616@gmail.com',
   'pending', 'pending',
   'Recreated 2026-07-31 from transaction 23374cf8. Original confirmation was cascade-deleted with the duplicate transaction removed by migration 20260723210000.'),

  (gen_random_uuid(), 'DC-NIYOM-006-004',
   'e510c684-08ec-4fe7-abec-13d18a853ab5', '6561291d-d7fd-4b8a-80ba-7c54c4371dbe', 'confirmed',
   '2026-07-03', 'Buy', 'Unlisted Share', 'HINDUJA LEYLAND FINANCE', 'INE146O01014',
   500, 240.00, 240.00, 230,
   'SANJAY GUPTA', 'ADHPG1776H', 'ZERODHA SECURITIES PVT LTD', '1208160187749991', 'CDSL',
   'SBI', '34098732813', 'SBIN0000707',
   'CIVIL LINES, ROORKEE DIST, HARDWAR HARIDWAR UTTARAKHAND 247667',
   '9927074777', 'sanjaygupta2464@gmail.com',
   'pending', 'pending',
   'Recreated 2026-07-31 from transaction 95c60e1d. Original confirmation was cascade-deleted with the duplicate transaction removed by migration 20260723210000.');

ALTER TABLE nw_transactions DISABLE TRIGGER trg_nw_check_txn_post_transfer_immutable;

UPDATE nw_transactions t
   SET deal_confirmation_id = d.id,
       transfer_remarks = COALESCE(NULLIF(btrim(t.transfer_remarks), ''),
                            'Linked to ' || d.confirmation_number || ' when the deal confirmation was recreated.'),
       updated_at = now()
  FROM nw_deal_confirmations d
 WHERE d.confirmation_number IN ('DC-NIYOM-006-003', 'DC-NIYOM-006-004')
   AND t.client_id = d.client_id
   AND t.deal_confirmation_id IS NULL
   AND t.product_name = 'HINDUJA LEYLAND FINANCE'
   AND t.txn_date = '2026-07-03';

ALTER TABLE nw_transactions ENABLE TRIGGER trg_nw_check_txn_post_transfer_immutable;

DO $$
DECLARE v int; s numeric;
BEGIN
  SELECT count(*) INTO v FROM nw_deal_confirmations
   WHERE confirmation_number IN ('DC-NIYOM-006-003','DC-NIYOM-006-004');
  IF v <> 2 THEN RAISE EXCEPTION 'Expected 2 deal confirmations, got %.', v; END IF;

  -- The generated settlement must reproduce each transaction's own amount.
  SELECT count(*) INTO v
    FROM nw_deal_confirmations d
    JOIN nw_transactions t ON t.deal_confirmation_id = d.id
   WHERE d.confirmation_number IN ('DC-NIYOM-006-003','DC-NIYOM-006-004')
     AND d.settlement_amount = t.consolidated_amount;
  IF v <> 2 THEN RAISE EXCEPTION 'Settlement/consolidated mismatch (% of 2 agree).', v; END IF;

  SELECT count(*) INTO v FROM nw_transactions t
    JOIN nw_deal_confirmations d ON d.id = t.deal_confirmation_id
   WHERE d.confirmation_number IN ('DC-NIYOM-006-003','DC-NIYOM-006-004');
  IF v <> 2 THEN RAISE EXCEPTION 'Only % of 2 transactions linked.', v; END IF;

  -- One transaction per deal, still.
  SELECT count(*) INTO v FROM (
    SELECT deal_confirmation_id FROM nw_transactions
     WHERE deal_confirmation_id IS NOT NULL
     GROUP BY deal_confirmation_id HAVING count(*) > 1) x;
  IF v <> 0 THEN RAISE EXCEPTION '% deal(s) claimed by multiple transactions.', v; END IF;

  SELECT sum(settlement_amount) INTO s FROM nw_deal_confirmations
   WHERE confirmation_number IN ('DC-NIYOM-006-003','DC-NIYOM-006-004');
  RAISE NOTICE 'Recreated 2 deal confirmations, settlement total Rs.%', s;
END $$;

COMMIT;
