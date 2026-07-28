-- Bug fix: deleting an nw_transaction that sits on a SIGNED or PAID DSA debit
-- note used to silently strip the coverage line (admins only), leaving the
-- signed/paid note orphaned with zero line items — exactly what happened to
-- DN-2026-07-0018. The BEFORE DELETE unwind trigger now refuses to delete such
-- a transaction for EVERYONE (admins included). Only unsigned/unpaid draft
-- notes may still have their coverage line removed by an admin (the draft can
-- simply be regenerated afterward).
CREATE OR REPLACE FUNCTION public.nw_txn_before_delete_unwind()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locked_note text;
BEGIN
  IF EXISTS (SELECT 1 FROM dsa_debit_note_lines WHERE transaction_id = OLD.id) THEN
    -- Hard stop: a transaction covered by a signed or paid debit note is locked.
    -- Removing it would gut a document the DSA has legally signed (or that has
    -- already been paid out). Block for admins too — the note must be cancelled
    -- or otherwise unwound first.
    SELECT dn.debit_note_number
      INTO v_locked_note
    FROM dsa_debit_note_lines l
    JOIN dsa_debit_notes dn ON dn.id = l.debit_note_id
    WHERE l.transaction_id = OLD.id
      AND (dn.signature_status = 'signed' OR dn.status = 'paid')
    LIMIT 1;

    IF v_locked_note IS NOT NULL THEN
      RAISE EXCEPTION
        'This transaction is on debit note % which is signed/paid and locked. Cancel or unwind that debit note before deleting the transaction.',
        v_locked_note
        USING ERRCODE = 'check_violation';
    END IF;

    -- Otherwise the covering note is still an unsigned, unpaid draft: only an
    -- admin may drop its coverage line (the draft can be regenerated).
    IF NOT nw_current_emp_is_admin() THEN
      RAISE EXCEPTION 'This transaction is on a DSA debit note. Ask an admin to remove it.'
        USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM dsa_debit_note_lines WHERE transaction_id = OLD.id;
  END IF;

  PERFORM nw_unwind_txn_holding(OLD);
  RETURN OLD;
END;
$function$;
