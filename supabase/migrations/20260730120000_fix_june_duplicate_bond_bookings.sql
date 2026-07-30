/*
  # Fix June 2026 duplicate bookings (Utkarsh, ESAF, MSEI)

  Three positions were each booked TWICE — once manually and once through the
  deal → transfer flow. Only one holding row exists per position, so the
  portfolio was never wrong; the damage was to MIS:

    * the transferred/deal-linked copy carries NO landing cost or dsa_price, so
      MIS showed it as "⚠ landing cost pending" at Rs.0;
    * the manual copy carries the correct prices but is excluded by the MIS
      "genuine business" gate (no transfer_stage, no deal_confirmation_id).

  Net effect: June understated by Rs.19,393.

  The MANUAL rows are authoritative — they are the rows the DSA was actually
  paid against on DN-2026-06-0001 (signed + paid), and their spreads reconcile
  to that note exactly:

    VIKAS CHANDRA GOYAL  (103750 - 102677) x 8 = 8584  ->  DN line 8584  OK
    SHIVAM GUPTA (HUF)   (106139.2 - 105219.2) x 5 = 4600 -> DN line 4600 OK

  So the manual row survives and INHERITS the deal/transfer linkage; the
  deal-linked duplicate is removed.

  Deletion mechanics — the duplicate is removed with three guards disabled, on
  purpose:
    * trg_nw_txn_before_delete_unwind would unwind the single shared holding,
      leaving the client short the whole position. The holding must survive.
    * trg_nw_txn_delete_cascade_deal would delete the deal confirmation AND its
      payment history. The deal must survive (it moves to the surviving row).
      Linkage is cleared off the duplicate first, so this is belt-and-braces.
    * the post-transfer immutability / no-delete guards block the linkage move.

  Rows removed (details retained here so they can be re-entered if ever needed):
    003f92d8-5d9f-47c8-9b43-a524d2e7499f  UTKARSH SFB 2031  8 @ 103734.44  2026-06-16
    0c2cd610-6660-4188-ab05-47dad5f846c0  ESAF SFB 2032     5 @ 106123.28  2026-06-18
    88b68525-4425-4b13-989f-ea9d54bc9f05  MSEI           5000 @ 5.65       2026-07-20

  The MSEI pair (NW-006-0007, direct-sourced) needs no linkage move: the
  transferred copy df49f0c1 already carries landing cost 5.53 and is already
  counted correctly in July. Only its stray manual twin is dropped.
*/

BEGIN;

-- Pair up survivor (manual, debit-note anchored) with the duplicate to remove.
CREATE TEMP TABLE _dup_fix (survivor_id uuid, dup_id uuid) ON COMMIT DROP;
INSERT INTO _dup_fix VALUES
  ('b5bdfaac-8349-42a8-b029-89192264a300', '003f92d8-5d9f-47c8-9b43-a524d2e7499f'),
  ('13b95ff4-2b2d-4bf3-857c-55e6f08b31d9', '0c2cd610-6660-4188-ab05-47dad5f846c0');

CREATE TEMP TABLE _affected_clients AS
  SELECT DISTINCT client_id FROM nw_transactions
   WHERE id IN (SELECT dup_id FROM _dup_fix)
      OR id = '88b68525-4425-4b13-989f-ea9d54bc9f05';

ALTER TABLE nw_transactions DISABLE TRIGGER trg_nw_check_txn_post_transfer_immutable;
ALTER TABLE nw_transactions DISABLE TRIGGER trg_nw_check_txn_no_delete_after_transfer;
ALTER TABLE nw_transactions DISABLE TRIGGER trg_nw_txn_before_delete_unwind;
ALTER TABLE nw_transactions DISABLE TRIGGER trg_nw_txn_delete_cascade_deal;

-- 1. Snapshot the linkage carried by each duplicate.
CREATE TEMP TABLE _linkage ON COMMIT DROP AS
  SELECT f.survivor_id, t.deal_confirmation_id, t.transfer_stage,
         t.transferred_at, t.transferred_by, t.transfer_reference, t.transfer_remarks
    FROM _dup_fix f JOIN nw_transactions t ON t.id = f.dup_id;

-- 2. Release it from the duplicate (also defuses the deal-cascade trigger).
UPDATE nw_transactions
   SET deal_confirmation_id = NULL, transfer_stage = NULL,
       transferred_at = NULL, transferred_by = NULL,
       transfer_reference = NULL, transfer_remarks = NULL
 WHERE id IN (SELECT dup_id FROM _dup_fix);

-- 3. Hand it to the surviving (authoritative) row.
UPDATE nw_transactions t
   SET deal_confirmation_id = l.deal_confirmation_id,
       transfer_stage       = l.transfer_stage,
       transferred_at       = l.transferred_at,
       transferred_by       = l.transferred_by,
       transfer_reference   = l.transfer_reference,
       transfer_remarks     = l.transfer_remarks
  FROM _linkage l
 WHERE t.id = l.survivor_id;

-- 4. Drop the duplicates. Holdings and deal confirmations are left intact.
DELETE FROM nw_transactions
 WHERE id IN (SELECT dup_id FROM _dup_fix)
    OR id = '88b68525-4425-4b13-989f-ea9d54bc9f05';

ALTER TABLE nw_transactions ENABLE TRIGGER trg_nw_check_txn_post_transfer_immutable;
ALTER TABLE nw_transactions ENABLE TRIGGER trg_nw_check_txn_no_delete_after_transfer;
ALTER TABLE nw_transactions ENABLE TRIGGER trg_nw_txn_before_delete_unwind;
ALTER TABLE nw_transactions ENABLE TRIGGER trg_nw_txn_delete_cascade_deal;

UPDATE nw_clients c
   SET portfolio_value = COALESCE(
     (SELECT SUM(current_value) FROM nw_holdings WHERE client_id = c.id), 0)
 WHERE c.id IN (SELECT client_id FROM _affected_clients);

DROP TABLE _affected_clients;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM nw_transactions
   WHERE id IN ('003f92d8-5d9f-47c8-9b43-a524d2e7499f',
                '0c2cd610-6660-4188-ab05-47dad5f846c0',
                '88b68525-4425-4b13-989f-ea9d54bc9f05');
  IF v <> 0 THEN RAISE EXCEPTION 'Duplicates still present (%).', v; END IF;

  -- Both deal confirmations must have survived, now on the surviving rows.
  SELECT count(*) INTO v FROM nw_deal_confirmations
   WHERE id IN ('d9faaeba-5097-4fb0-adbc-6c939b737b1a',
                '578bfaf1-0116-4ede-8c82-26747ab418e1');
  IF v <> 2 THEN RAISE EXCEPTION 'Deal confirmations lost (% of 2).', v; END IF;

  SELECT count(*) INTO v FROM nw_transactions
   WHERE id IN ('b5bdfaac-8349-42a8-b029-89192264a300',
                '13b95ff4-2b2d-4bf3-857c-55e6f08b31d9')
     AND transfer_stage = 'transferred' AND deal_confirmation_id IS NOT NULL;
  IF v <> 2 THEN RAISE EXCEPTION 'Linkage not moved (% of 2).', v; END IF;

  -- The debit note lines must still point at live transactions.
  SELECT count(*) INTO v FROM dsa_debit_note_lines l
   WHERE NOT EXISTS (SELECT 1 FROM nw_transactions t WHERE t.id = l.transaction_id);
  IF v <> 0 THEN RAISE EXCEPTION 'Orphaned debit note lines (%).', v; END IF;

  RAISE NOTICE 'June duplicate bookings reconciled.';
END $$;

COMMIT;
