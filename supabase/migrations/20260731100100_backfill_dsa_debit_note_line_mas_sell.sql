/*
  # Backfill the missing ledger line for the MAS Financial sell

  DN-2026-06-0007 (NWDSA-007-001, Jun 2026, gross 10,000.00) was raised before
  dsa_debit_note_lines existed and never received a line. Its sole underlying
  transaction -- the 2026-06-24 MAS FINANCIAL SERVICES sell for client
  NW-007-0003, payout (98,059 - 97,059) x 10 = 10,000.00 -- was therefore
  attached to no note at all, leaving it invisible to DSAPayout's "already paid"
  guard and eligible to be paid a second time.

  Attaching it closes that gap. The note's own monetary figures are untouched;
  the line total (10,000.00) equals the note's payout_amount exactly.

  Deliberately NOT backfilled here: NWDSA-005-001's two 2026-06-03 ROYALCARE
  transactions (750.00 each). Their note DN-2026-06-0002 is only 1,000.00, so
  attaching both would make the lines (1,500.00) exceed the note and misstate it.
  That DSA is genuinely UNDER-paid by 500.00; the correct remedy is a
  supplementary note raised through the CRM, which will create the lines
  properly. Until then those two transactions remain unguarded -- flagged rather
  than papered over.

  ## Safety
    Idempotent via ON CONFLICT DO NOTHING against uq_dsa_debit_note_lines_txn.
    Additive only: inserts one row, changes no existing figure.
*/
INSERT INTO dsa_debit_note_lines (debit_note_id, transaction_id, payout)
SELECT n.id, t.id,
       (t.dsa_price - t.client_price) * t.quantity
FROM dsa_debit_notes n
CROSS JOIN nw_transactions t
WHERE n.debit_note_number = 'DN-2026-06-0007'
  AND t.id = '8ab8b946-4afe-4d14-8198-f8b66dab680c'
ON CONFLICT (transaction_id) DO NOTHING;
