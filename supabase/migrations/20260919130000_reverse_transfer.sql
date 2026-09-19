-- =============================================================================
-- Reverse a transfer approved by mistake (admin only).
--
-- nw_transfer_deal finalises each line of a deal in one of two ways, and the
-- reversal has to undo exactly what happened to that line:
--
--   1. The line was ALREADY BOOKED (a pending nw_transactions row from Add New
--      Business): the transfer only stamped it. Reversal clears the stamp —
--      stage, date, approver, remarks, reference, snapshot — and the row is
--      back to pending, exactly as before. Its holding was created at booking
--      time, not by the transfer, so it stays.
--
--   2. The transfer CREATED the row (INSERT). That insert fired
--      trg_nw_txn_apply_holding_on_transfer, which added to the client's
--      holding. Reversal deletes the row; nw_txn_before_delete_unwind reverses
--      the holding. The stage is cleared FIRST so that
--      nw_txn_after_delete_remove_deal (which deletes the whole deal when a
--      *transferred* row goes) does not fire — the deal must survive and go
--      back to the queue. A row on a signed/paid DSA debit note is refused by
--      the existing delete guard, which aborts the whole reversal.
--
-- Which case a line is: created rows have created_at equal to the snapshot's
-- snapshot_taken_at (both now() of the transferring transaction); stamped rows
-- were created earlier.
--
-- Nothing is erased from the audit trail: the original 'transferred' event
-- stays and a 'transfer_reversed' event records every line's prior state.
-- The closure email already sent to the client cannot be recalled.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.nw_reverse_transfer(p_deal_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_admin    nw_employees%ROWTYPE;
  v_deal     nw_deal_confirmations%ROWTYPE;
  v_txn      nw_transactions%ROWTYPE;
  v_created  boolean;
  v_lines    jsonb := '[]'::jsonb;
  v_refs     text[] := '{}';
  v_restored int := 0;
  v_removed  int := 0;
BEGIN
  -- Admins only. The Transfer-Queue-only login (transfer_admin) can approve
  -- transfers but not undo them.
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can reverse a transfer.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Give a reason for reversing the transfer.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_admin FROM nw_employees WHERE id = nw_current_employee_id();

  SELECT * INTO v_deal FROM nw_deal_confirmations WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found.' USING ERRCODE = 'no_data_found';
  END IF;

  FOR v_txn IN
    SELECT * FROM nw_transactions
     WHERE deal_confirmation_id = p_deal_id AND transfer_stage = 'transferred'
     ORDER BY transfer_reference
     FOR UPDATE
  LOOP
    v_created := (v_txn.snapshot ? 'snapshot_taken_at')
      AND abs(extract(epoch FROM (v_txn.created_at - (v_txn.snapshot->>'snapshot_taken_at')::timestamptz))) < 1;

    v_lines := v_lines || jsonb_build_object(
      'transaction_id', v_txn.id,
      'transfer_reference', v_txn.transfer_reference,
      'action', CASE WHEN v_created THEN 'removed' ELSE 'restored_to_pending' END,
      'product_name', v_txn.product_name, 'quantity', v_txn.quantity,
      'consolidated_amount', v_txn.consolidated_amount,
      'original_transferred_at', v_txn.transferred_at,
      'original_transferred_by', v_txn.transferred_by,
      'original_remarks', v_txn.transfer_remarks,
      'original_snapshot', v_txn.snapshot);
    v_refs := v_refs || v_txn.transfer_reference;

    -- Clearing the stage first matters for BOTH paths (see header).
    UPDATE nw_transactions SET
      transfer_stage = NULL, transferred_at = NULL, transferred_by = NULL,
      transfer_remarks = NULL, transfer_reference = NULL, snapshot = '{}'::jsonb
    WHERE id = v_txn.id;

    IF v_created THEN
      DELETE FROM nw_transactions WHERE id = v_txn.id;   -- unwinds the holding
      v_removed := v_removed + 1;
    ELSE
      v_restored := v_restored + 1;
    END IF;
  END LOOP;

  IF v_restored + v_removed = 0 THEN
    RAISE EXCEPTION 'This deal has no transferred lines to reverse.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO nw_deal_confirmation_events (deal_id, event_type, actor, metadata)
  VALUES (p_deal_id, 'transfer_reversed', 'employee', jsonb_build_object(
    'reversed_transfer_references', to_jsonb(v_refs),
    'lines', v_lines,
    'lines_restored_to_pending', v_restored,
    'lines_removed', v_removed,
    'reversed_by', v_admin.id, 'reversed_by_name', v_admin.full_name,
    'reason', btrim(p_reason), 'reversed_at', now()));

  RETURN jsonb_build_object(
    'reversed_references', to_jsonb(v_refs),
    'restored', v_restored, 'removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.nw_reverse_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_reverse_transfer(uuid, text) TO authenticated;
