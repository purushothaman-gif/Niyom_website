/*
  # Remove the 06-Jul-2026 duplicate DSA debit notes

  ## What happened
  dsa_debit_note_lines -- the ledger that stops a transaction being paid twice --
  was only introduced on 2026-07-18 (20260718100000). Before that DSAPayout had
  no way to know a transaction had already been paid out. On 2026-07-06 a payout
  run was executed for months whose business an existing note already covered,
  and nothing blocked it. Five duplicate notes were created and marked paid
  within ~2 minutes of creation.

  When the ledger was later backfilled, uq_dsa_debit_note_lines_txn
  (UNIQUE (transaction_id)) allowed each transaction to attach to only ONE note.
  The earlier, legitimate note won; the duplicate was left with zero lines --
  which is exactly why every duplicate below has no lines.

  Each duplicate's pdf_snapshot.particulars lists an identical client, product,
  quantity and amount to its earlier counterpart, confirming it is the same
  business billed twice.

  | DSA           | Deleted (dup)   | Period | Gross     | Duplicates      |
  |---------------|-----------------|--------|-----------|-----------------|
  | NWDSA-001-001 | DN-2026-05-0013 | May 26 | 22,000.00 | DN-2026-06-0008 |
  | NWDSA-003-001 | DN-2026-06-0009 | Jun 26 | 33,600.00 | DN-2026-05-0006 |
  | NWDSA-006-001 | DN-2026-05-0010 | May 26 | 13,184.00 | DN-2026-06-0001 |
  | NWDSA-007-001 | DN-2026-05-0011 | May 26 | 10,000.00 | DN-2026-06-0007 |
  | NWDSA-007-002 | DN-2026-05-0012 | May 26 | 28,750.00 | DN-2026-06-0005 |
  Total gross 107,534.00 / net 105,383.32.

  ## Safety
    - Every row (and its child events) is copied into dsa_debit_notes_deleted_backup
      / dsa_debit_note_events_deleted_backup FIRST, in the same transaction, so
      the delete is fully reversible.
    - All five are signature_status='not_sent': none was ever sent or signed, so
      no signed artefact or counterparty-signed evidence is destroyed.
    - All five have zero dsa_debit_note_lines, so no payout ledger row is lost
      and no transaction becomes unclaimed by this delete.
    - Child rows cascade (events, otps, lines all ON DELETE CASCADE).
    - This records the accounting correction. It does NOT recover the cash that
      was disbursed -- that remains a commercial matter with each partner.
*/

-- 1. Durable in-database backup ------------------------------------------------
CREATE TABLE IF NOT EXISTS dsa_debit_notes_deleted_backup
  (LIKE dsa_debit_notes INCLUDING DEFAULTS);
ALTER TABLE dsa_debit_notes_deleted_backup
  ADD COLUMN IF NOT EXISTS deleted_at     timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_reason text;
ALTER TABLE dsa_debit_notes_deleted_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read deleted debit note backup" ON dsa_debit_notes_deleted_backup;
CREATE POLICY "Admins read deleted debit note backup"
  ON dsa_debit_notes_deleted_backup FOR SELECT TO authenticated
  USING ((SELECT nw_current_emp_is_admin()));

CREATE TABLE IF NOT EXISTS dsa_debit_note_events_deleted_backup
  (LIKE dsa_debit_note_events INCLUDING DEFAULTS);
ALTER TABLE dsa_debit_note_events_deleted_backup
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE dsa_debit_note_events_deleted_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read deleted debit note event backup" ON dsa_debit_note_events_deleted_backup;
CREATE POLICY "Admins read deleted debit note event backup"
  ON dsa_debit_note_events_deleted_backup FOR SELECT TO authenticated
  USING ((SELECT nw_current_emp_is_admin()));

-- 2. Copy the doomed rows ------------------------------------------------------
INSERT INTO dsa_debit_note_events_deleted_backup
SELECT e.* FROM dsa_debit_note_events e
WHERE e.debit_note_id IN (
  SELECT id FROM dsa_debit_notes WHERE debit_note_number IN
   ('DN-2026-05-0013','DN-2026-06-0009','DN-2026-05-0010','DN-2026-05-0012','DN-2026-05-0011'));

INSERT INTO dsa_debit_notes_deleted_backup
SELECT n.*, now(),
       'Duplicate of an earlier note for the same business; created by the '
       || '2026-07-06 payout run before dsa_debit_note_lines existed to guard '
       || 'against re-payment. Zero ledger lines, never sent or signed.'
FROM dsa_debit_notes n
WHERE n.debit_note_number IN
 ('DN-2026-05-0013','DN-2026-06-0009','DN-2026-05-0010','DN-2026-05-0012','DN-2026-05-0011');

-- 3. Guard: refuse to proceed unless exactly 5 rows were backed up -------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM dsa_debit_notes_deleted_backup;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'Expected 5 backed-up notes, found %. Aborting delete.', v_n;
  END IF;
END $$;

-- 4. Delete --------------------------------------------------------------------
DELETE FROM dsa_debit_notes
WHERE debit_note_number IN
 ('DN-2026-05-0013','DN-2026-06-0009','DN-2026-05-0010','DN-2026-05-0012','DN-2026-05-0011');
