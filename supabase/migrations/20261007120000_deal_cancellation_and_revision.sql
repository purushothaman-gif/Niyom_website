/*
  Deal cancellation (unpaid after 24h) + revision tracking.

  CANCELLATION
    When a Deal Confirmation has been emailed and the client has not paid within
    24 hours of the send time, the owning employee or an admin may cancel the
    deal and email the client a cancellation notice.

    A cancelled deal is marked by `cancelled_at IS NOT NULL`. Its
    acceptance_status moves to 'expired' and the secure link is cleared, so the
    existing exclusions (transfer queue, record-payment, the public signing
    page) already treat it as dead — no view or function that filters on
    acceptance_status needed to change.

    The deal may have been ACCEPTED (signed) by the client and still be unpaid —
    the common case. nw_block_accepted_deal_update makes accepted deals immutable
    to non-admins, so nw_cancel_deal() raises a transaction-local flag that the
    guard honours. The flag is only ever set inside that SECURITY DEFINER
    function, after its own ownership / 24h / unpaid / not-booked checks.

  REVISION
    Editing a deal that was already sent keeps the same confirmation number.
    revision_no counts those amendments so the note and the resend email can say
    "Revision N". Editing a cancelled deal clears the cancellation (reissue).

  Additive only — no existing column or value is removed.
*/

ALTER TABLE nw_deal_confirmations
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by        uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS revision_no         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revised_at          timestamptz;

CREATE INDEX IF NOT EXISTS idx_nw_deal_confirmations_cancelled_by
  ON nw_deal_confirmations (cancelled_by) WHERE cancelled_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Allow-lists: one new email type, two new audit events.
-- ---------------------------------------------------------------------------
ALTER TABLE nw_deal_email_log DROP CONSTRAINT nw_deal_email_log_email_type_check;
ALTER TABLE nw_deal_email_log
  ADD CONSTRAINT nw_deal_email_log_email_type_check
  CHECK (email_type IN (
    'secure_link', 'signed_pdf', 'payment_reminder', 'payment_partial',
    'payment_final', 'deal_closure', 'payment_link', 'deal_cancellation'
  ));

ALTER TABLE nw_deal_confirmation_events DROP CONSTRAINT nw_deal_confirmation_events_event_type_check;
ALTER TABLE nw_deal_confirmation_events
  ADD CONSTRAINT nw_deal_confirmation_events_event_type_check
  CHECK (event_type IN (
    'link_sent', 'viewed', 'otp_sent', 'otp_verified', 'accepted', 'rejected',
    'edited', 'token_invalidated', 'expired', 'tc_accepted', 'signed_pdf_emailed',
    'payment_recorded', 'payment_updated', 'payment_cancelled', 'payment_reversed',
    'payment_completed', 'outstanding_updated', 'receipt_generated',
    'receipt_regenerated', 'receipt_downloaded', 'receipt_emailed',
    'reconciliation_matched', 'reconciliation_disputed', 'transferred',
    'closure_emailed', 'closure_email_failed', 'transfer_reversed',
    'revenue_basis_updated', 'cancelled', 'cancellation_emailed'
  ));

-- ---------------------------------------------------------------------------
-- Accepted-deal guard: unchanged, except it stands aside for nw_cancel_deal().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nw_block_accepted_deal_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.acceptance_status = 'accepted'
     AND NOT nw_current_emp_is_admin()
     AND COALESCE(current_setting('nw.deal_cancel', true), '') <> '1' THEN
    RAISE EXCEPTION
      'Accepted deal confirmation % is immutable. Create a new deal confirmation for corrections.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- nw_cancel_deal — owning employee or admin; all rules enforced here.
-- Idempotent: an already-cancelled deal returns already_cancelled = true so the
-- caller can re-send the notice without a second state change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nw_cancel_deal(p_deal_id uuid, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp    nw_employees%ROWTYPE;
  v_deal   nw_deal_confirmations%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_due    timestamptz;
BEGIN
  SELECT * INTO v_emp FROM nw_employees
   WHERE auth_user_id = auth.uid() AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorised.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_deal FROM nw_deal_confirmations WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_emp.role NOT IN ('admin', 'super_admin')
     AND NOT (v_emp.role = 'employee' AND v_deal.employee_id = v_emp.id) THEN
    RAISE EXCEPTION 'You can only cancel your own deals.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_deal.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_cancelled', true, 'cancelled_at', v_deal.cancelled_at);
  END IF;

  IF v_deal.transaction_type <> 'Buy' THEN
    RAISE EXCEPTION 'Only Buy deals can be cancelled for non-payment.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_deal.email_status <> 'sent' OR v_deal.email_sent_at IS NULL THEN
    RAISE EXCEPTION 'This deal confirmation has not been emailed to the client yet.' USING ERRCODE = 'check_violation';
  END IF;

  v_due := v_deal.email_sent_at + interval '24 hours';
  IF now() < v_due THEN
    RAISE EXCEPTION 'The client has until % IST to pay (24 hours from the mail). Cancellation opens after that.',
      to_char(v_due AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM nw_deal_payments
              WHERE deal_confirmation_id = p_deal_id AND status = 'active') THEN
    RAISE EXCEPTION 'A payment is recorded against this deal — it cannot be cancelled for non-payment.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM nw_transactions WHERE deal_confirmation_id = p_deal_id) THEN
    RAISE EXCEPTION 'This deal is already booked as a transaction.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('nw.deal_cancel', '1', true);
  UPDATE nw_deal_confirmations SET
    cancelled_at        = now(),
    cancelled_by        = v_emp.id,
    cancellation_reason = v_reason,
    acceptance_status   = 'expired',
    secure_token        = NULL,
    token_expires_at    = NULL
  WHERE id = p_deal_id;
  PERFORM set_config('nw.deal_cancel', '', true);

  INSERT INTO nw_deal_confirmation_events (deal_id, event_type, actor, metadata)
  VALUES (p_deal_id, 'cancelled', 'employee', jsonb_build_object(
    'cancelled_by', v_emp.id,
    'reason', v_reason,
    'mail_sent_at', v_deal.email_sent_at,
    'was_acceptance_status', v_deal.acceptance_status
  ));

  RETURN jsonb_build_object('already_cancelled', false, 'cancelled_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.nw_cancel_deal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_cancel_deal(uuid, text) TO authenticated;
