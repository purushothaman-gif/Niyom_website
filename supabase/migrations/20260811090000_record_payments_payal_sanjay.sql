/*
  # Record the client payments for PAYAL GARG and SANJAY GUPTA

  Their deal confirmations were recreated by 20260731090000, but no payment rows
  existed, so under payment-month recognition both read Rs.0 "Awaiting payment"
  and Rs.5,000 of genuine July revenue sat outside MIS.

  The original payment records were destroyed on 2026-07-23: migration
  20260723210000 deleted the transactions as DSA-payout duplicates, and
  trg_nw_txn_delete_cascade_deal removed each deal confirmation together with its
  nw_deal_payments rows. 20260723220000 then restored the transactions and the
  DSA coverage, but not the deals or the payments.

  Amounts are NOT invented — each equals its deal's generated settlement_amount,
  which in turn reproduces the transaction's consolidated_amount:

    PAYAL GARG    (NW-006-0005)  DC-NIYOM-006-003  Rs.2,39,960  paid 03-Jul-2026
    SANJAY GUPTA  (NW-006-0006)  DC-NIYOM-006-004  Rs.1,20,000  paid 07-Jul-2026

  Payment DATES are owner-supplied from their own records. They matter: they
  decide the month the revenue is recognised in. Both fall in July, so the
  Rs.5,000 returns to July rather than landing in August.

  payment_mode is recorded as 'bank_transfer' and no UTR is set, because neither
  is known — the originals went with the cascade. The remarks say so plainly on
  each row rather than dressing a reconstruction up as a verified bank receipt.
  If the real mode and UTR are recovered, amend these two rows.

  Inserted through nw_insert_payment(), the same RPC the record-payment edge
  function uses, so payment_number allocation happens under the deal-row lock and
  the AFTER INSERT audit triggers (payment_recorded / outstanding_updated /
  payment_completed) fire exactly as they would from the UI. received_from_bank
  is each client's primary bank on file.
*/

BEGIN;

DO $$
DECLARE
  v_emp uuid := '6561291d-d7fd-4b8a-80ba-7c54c4371dbe';  -- ANANDHAN K (NIYOM-006), both deals' RM
  v_deal uuid;
  v_amt  numeric;
  r      record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('DC-NIYOM-006-003', DATE '2026-07-03', 'PAYAL GARG',   'YES BANK'),
      ('DC-NIYOM-006-004', DATE '2026-07-07', 'SANJAY GUPTA', 'SBI')
    ) AS v(conf_no, pay_date, client_name, bank)
  LOOP
    SELECT id, settlement_amount INTO v_deal, v_amt
      FROM nw_deal_confirmations WHERE confirmation_number = r.conf_no;

    IF v_deal IS NULL THEN
      RAISE EXCEPTION 'Deal % not found.', r.conf_no;
    END IF;

    -- Idempotent: never double-record if this migration is replayed.
    IF EXISTS (SELECT 1 FROM nw_deal_payments
                WHERE deal_confirmation_id = v_deal AND status = 'active') THEN
      RAISE NOTICE 'Deal % already has an active payment; skipping.', r.conf_no;
      CONTINUE;
    END IF;

    PERFORM nw_insert_payment(jsonb_build_object(
      'deal_confirmation_id', v_deal,
      'amount',               v_amt,
      'currency',             'INR',
      'direction',            'inflow',
      'payment_mode',         'bank_transfer',
      'payment_date',         to_char(r.pay_date, 'YYYY-MM-DD'),
      'received_by',          v_emp,
      'received_from_name',   r.client_name,
      'received_from_bank',   r.bank,
      'provider',             'manual',
      'remarks',              'Reconstructed 2026-08-11. The original payment record was deleted on 2026-07-23 '
                              || 'when migration 20260723210000 removed the transaction and the delete-cascade took '
                              || 'the deal confirmation and its payments with it. Amount equals the deal settlement; '
                              || 'payment date supplied by the owner. Original mode and UTR are not recoverable.',
      'created_by',           v_emp,
      'updated_by',           v_emp
    ));
  END LOOP;
END $$;

DO $$
DECLARE n int; s record; pay_month text;
BEGIN
  -- Both deals must now be settled in full.
  SELECT count(*) INTO n
    FROM nw_deal_payment_summary
   WHERE confirmation_number IN ('DC-NIYOM-006-003','DC-NIYOM-006-004')
     AND payment_status = 'fully_paid';
  IF n <> 2 THEN RAISE EXCEPTION 'Expected 2 fully_paid deals, got %.', n; END IF;

  -- Exactly one active payment each, and nothing outstanding.
  FOR s IN
    SELECT confirmation_number, total_paid_amount, outstanding_amount, payment_count
      FROM nw_deal_payment_summary
     WHERE confirmation_number IN ('DC-NIYOM-006-003','DC-NIYOM-006-004')
  LOOP
    IF s.payment_count <> 1 THEN
      RAISE EXCEPTION '% has % payments, expected 1.', s.confirmation_number, s.payment_count;
    END IF;
    IF s.outstanding_amount <> 0 THEN
      RAISE EXCEPTION '% outstanding is %, expected 0.', s.confirmation_number, s.outstanding_amount;
    END IF;
  END LOOP;

  -- And the revenue must now be recognised in JULY, not left awaiting.
  SELECT to_char(max(p.payment_date), 'YYYY-MM') INTO pay_month
    FROM nw_deal_payments p
    JOIN nw_deal_confirmations d ON d.id = p.deal_confirmation_id
   WHERE d.confirmation_number IN ('DC-NIYOM-006-003','DC-NIYOM-006-004')
     AND p.status = 'active';
  IF pay_month <> '2026-07' THEN
    RAISE EXCEPTION 'Payments land in %, expected 2026-07.', pay_month;
  END IF;

  RAISE NOTICE 'Both payments recorded; Rs.5,000 returns to July.';
END $$;

COMMIT;
