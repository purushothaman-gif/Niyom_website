/*
  # Conversion-first onboarding redesign — nw_clients progressive-KYC fields

  ## Why
  The old public signup created a loginless nw_clients row only after a heavy
  5-step form + 3 mandatory document uploads. The redesigned flow creates a
  usable account from just Name + Mobile + Email, then completes KYC
  progressively inside the client portal (PAN verify -> documents ->
  investment preferences -> review). These columns carry the per-step progress
  so the dashboard checklist can render and the client can leave and resume.

  ## Columns added to nw_clients
    phone_verified          mobile OTP confirmed (Step 1)
    pan_verified            PAN verified via Cashfree (Step 2)
    pan_name                name as per PAN, fetched from Cashfree
    pan_doc_uploaded        PAN card copy uploaded (Step 3)
    bank_verified           bank proof (cheque/statement) uploaded (Step 3)
    cml_required            true when investment prefs include bonds/unlisted
    cml_uploaded            CML document uploaded (Step 3, when required)
    investment_preferences  chosen product access (Step 4)
    onboarding_status       overall onboarding stage
    kyc_submitted_at        when the client submitted KYC for review (Step 5)

  These booleans mirror KYC document state onto nw_clients because clients
  cannot read nw_documents directly (employee-only RLS) — the client portal
  drives its onboarding checklist off the client record alone.

  Idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK creation.
*/

ALTER TABLE nw_clients
  ADD COLUMN IF NOT EXISTS phone_verified         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pan_verified           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pan_name               text,
  ADD COLUMN IF NOT EXISTS pan_doc_uploaded       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_verified          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cml_required           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cml_uploaded           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS investment_preferences text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_status      text    NOT NULL DEFAULT 'account_created',
  ADD COLUMN IF NOT EXISTS kyc_submitted_at       timestamptz;

-- Constrain onboarding_status to the known stages (guarded so re-runs are safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nw_clients_onboarding_status_check'
  ) THEN
    ALTER TABLE nw_clients
      ADD CONSTRAINT nw_clients_onboarding_status_check
      CHECK (onboarding_status IN (
        'account_created', 'kyc_in_progress', 'kyc_submitted', 'kyc_under_review', 'active'
      ));
  END IF;
END $$;

-- Backfill onboarding_status for clients that predate the funnel so their portal
-- never shows a stale "action needed" checklist:
--   verified                      -> active (nothing left to do)
--   pending/partial with a PAN    -> kyc_under_review (RM already collected KYC;
--                                    the dashboard shows a calm "under review"
--                                    state rather than asking them to redo it)
UPDATE nw_clients
SET onboarding_status = 'active'
WHERE verification_status = 'verified'
  AND onboarding_status <> 'active';

UPDATE nw_clients
SET onboarding_status = 'kyc_under_review'
WHERE verification_status IN ('pending', 'partial')
  AND COALESCE(TRIM(pan), '') <> ''
  AND onboarding_status = 'account_created';

-- RM approval = flipping verification_status to 'verified' anywhere in the CRM.
-- A trigger keeps onboarding_status in lockstep so the client's dashboard
-- checklist completes ("Ready to Invest") the moment an RM approves, without
-- the CRM having to know about the onboarding funnel.
CREATE OR REPLACE FUNCTION nw_sync_onboarding_on_verify()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.verification_status = 'verified' THEN
    NEW.onboarding_status := 'active';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nw_sync_onboarding_on_verify ON nw_clients;
CREATE TRIGGER trg_nw_sync_onboarding_on_verify
  BEFORE INSERT OR UPDATE OF verification_status ON nw_clients
  FOR EACH ROW
  EXECUTE FUNCTION nw_sync_onboarding_on_verify();

-- Harden the RM-approval gate. A pre-existing broad RLS policy ("Clients can
-- update own password changed flag") lets a client UPDATE their own nw_clients
-- row without column restrictions — so a client could self-set
-- verification_status='verified' (and, via the trigger above, self-activate).
-- This guard rejects any client-initiated change to verification/onboarding/KYC
-- fields. Service-role edge functions (auth.uid() IS NULL) and employees
-- (auth.uid() != the client's) are unaffected; clients keep the fields they
-- legitimately own (investment_preferences, cml_required, client_password_changed).
CREATE OR REPLACE FUNCTION nw_guard_client_self_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.client_auth_user_id THEN
    IF NEW.verification_status  IS DISTINCT FROM OLD.verification_status
       OR NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status
       OR NEW.pan               IS DISTINCT FROM OLD.pan
       OR NEW.pan_verified      IS DISTINCT FROM OLD.pan_verified
       OR NEW.pan_name          IS DISTINCT FROM OLD.pan_name
       OR NEW.pan_doc_uploaded  IS DISTINCT FROM OLD.pan_doc_uploaded
       OR NEW.bank_verified     IS DISTINCT FROM OLD.bank_verified
       OR NEW.cml_uploaded      IS DISTINCT FROM OLD.cml_uploaded
       OR NEW.phone_verified    IS DISTINCT FROM OLD.phone_verified
       OR NEW.portfolio_value   IS DISTINCT FROM OLD.portfolio_value
       OR NEW.employee_id       IS DISTINCT FROM OLD.employee_id
       OR NEW.dsa_id            IS DISTINCT FROM OLD.dsa_id
       OR NEW.client_login_enabled IS DISTINCT FROM OLD.client_login_enabled
       OR NEW.client_auth_user_id  IS DISTINCT FROM OLD.client_auth_user_id
       OR NEW.client_code       IS DISTINCT FROM OLD.client_code THEN
      RAISE EXCEPTION 'Clients may not modify verification or onboarding fields.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nw_guard_client_self_update ON nw_clients;
CREATE TRIGGER trg_nw_guard_client_self_update
  BEFORE UPDATE ON nw_clients
  FOR EACH ROW
  EXECUTE FUNCTION nw_guard_client_self_update();
