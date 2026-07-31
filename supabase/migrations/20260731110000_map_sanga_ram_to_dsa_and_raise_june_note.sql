/*
  # SANGA RAM JANGID (NW-002-0003): direct -> DSA remap, and the June payout note

  The client was remapped to NWDSA-001-001 (DEENADAYALAN B) on 2026-07-31, but a
  remap on nw_clients alone does NOT make a payout possible: the underlying
  transaction was booked as direct business and still carried
  sourcing_type='direct' with dsa_price / client_price NULL. DSAPayout skips any
  transaction with a NULL price, so no payout would ever have been generated.
  This completes the remap and records the resulting note.

  ## Pricing derivation (from the agreed net payable of 5,782.00)
    gross   = 5782 / 0.98        = 5,900.00
    TDS @2%                      =   118.00
    spread  = 5900 / 1180 units  =     5.00 per unit
    client_price = 2085.00 (the per_unit_price already booked)
    dsa_price    = 2080.00
  Sanity against landing_cost 2070.00: firm keeps 10.00/unit (11,800.00), the
  DSA 5.00/unit (5,900.00) -- 17,700.00 total, identical to the margin the direct
  booking produced. Only the split changes, which is the point. The CLIENT's
  economics are untouched: 2085.00 is the price already on their signed deal
  confirmation.

  ## Payment date
  26-Jun-2026 IST, stored as 2026-06-25 18:30:00+00 -- exactly how
  confirmMarkPaid writes it (new Date('<date>T00:00:00').toISOString() from an
  IST browser). paid_at carries the BUSINESS payment date; the system timestamp
  lives on the marked_paid event.

  ## Not sent for signature
  signature_status stays 'not_sent' and no secure_token is minted. This note
  records a payment already made, per instruction.

  ## IMPORTANT -- must be applied in an ADMIN session, not as service role
  The transaction is transfer_stage='transferred' against a confirmed deal
  confirmation, so nw_check_txn_post_transfer_immutable() locks it. That trigger
  exempts admins (`NOT nw_current_emp_is_admin()`), which is the carve-out this
  correction relies on -- a plain service-role migration has no employee identity
  and is therefore REFUSED. Applied on 2026-07-31 in a session authenticated as
  Purushothaman S (super_admin), i.e. the same path the CRM itself would take.

  ## Safety
    - A ledger line links the note to the transaction. That is the guard which
      stops this business being paid a second time -- the exact failure that
      produced the five duplicates removed in 20260731100000.
    - pdf_url is NULL: the PDF is produced by the browser (jsPDF in
      src/crm/dsaDebitNote.ts) and cannot be generated server-side. pdf_snapshot
      is written in the app's own shape, so "Regenerate" in DSA Payout will
      reproduce the document exactly when the PDF is wanted.
    - Idempotent: guarded on the ledger line, so re-running does nothing.
*/
DO $$
DECLARE
  v_txn     uuid := '97e7ac79-4d95-45d2-b9fe-3382304a57b7';
  v_client  uuid := '922d10f1-7a09-4209-835a-dd1bc5c1cd5f';
  v_dsa     uuid := '350f3064-15eb-40e5-bd9e-7219de70e6fc';  -- NWDSA-001-001
  v_admin   uuid := '1b543112-3251-4912-847b-92982f2de563';  -- Purushothaman S
  v_gross   numeric := 5900.00;
  v_tds     numeric := 118.00;
  v_net     numeric := 5782.00;
  v_paid_at timestamptz := '2026-06-25 18:30:00+00';          -- 26-Jun-2026 IST
  v_number  text; v_note uuid; v_dsa_row jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM dsa_debit_note_lines WHERE transaction_id = v_txn) THEN
    RAISE NOTICE 'Already set up; nothing to do.'; RETURN;
  END IF;

  -- 1. Complete the remap on the transaction ---------------------------------
  UPDATE nw_transactions
     SET sourcing_type='dsa', dsa_id=v_dsa, dsa_code='NWDSA-001-001',
         dsa_price=2080.00, client_price=2085.00, updated_at=now()
   WHERE id = v_txn;

  -- 2. Mirror the prices onto the holding ------------------------------------
  UPDATE nw_holdings
     SET dsa_price=2080.00, client_price=2085.00, updated_at=now()
   WHERE client_id=v_client AND product_name='NSE';

  -- 3. Raise the note --------------------------------------------------------
  v_number := nw_generate_debit_note_number(2026, 6);
  SELECT to_jsonb(d) INTO v_dsa_row FROM nw_dsa d WHERE d.id=v_dsa;

  INSERT INTO dsa_debit_notes (
    dsa_id, month, year, payout_amount, tds_amount, net_payable_amount,
    debit_note_number, status, signature_status,
    created_by, generated_at, paid_at, paid_by, email_sent, pdf_snapshot)
  VALUES (
    v_dsa, 6, 2026, v_gross, v_tds, v_net, v_number, 'paid', 'not_sent',
    v_admin, now(), v_paid_at, v_admin, false,
    jsonb_build_object(
      'dsa', v_dsa_row, 'year', 2026, 'month', 6,
      'total', v_gross, 'tdsAmount', v_tds, 'netPayable', v_net,
      'dateISO', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'generatedBy', 'Purushothaman S', 'debitNoteNumber', v_number,
      'particulars', jsonb_build_array(jsonb_build_object(
        'payout', v_gross, 'quantity', 1180,
        'client_code','NW-002-0003','client_name','SANGA RAM JANGID',
        'product_name','NSE','product_type','unlisted_share'))))
  RETURNING id INTO v_note;

  -- 4. The ledger line -- stops this business ever being paid twice ----------
  INSERT INTO dsa_debit_note_lines (debit_note_id, transaction_id, payout)
  VALUES (v_note, v_txn, v_gross);

  -- 5. Audit trail -----------------------------------------------------------
  INSERT INTO dsa_debit_note_events (debit_note_id, event_type, actor, metadata)
  VALUES
   (v_note,'generated','employee', jsonb_build_object('debit_note_number',v_number,
      'regenerated',false,'note','Raised on remap of NW-002-0003 from direct to DSA')),
   (v_note,'marked_paid','employee', jsonb_build_object('net_payable',v_net,
      'payment_date','2026-06-26'));

  RAISE NOTICE 'Created % (gross %, tds %, net %)', v_number, v_gross, v_tds, v_net;
END $$;
