/*
  # MF account queue: has this client's account been opened on the platform?

  Staff open a client's mutual fund account by keying their details into the
  fund platform's own CRM. Nothing recorded whether that had been done, so the
  only signal that a client had been missed was the "not mapped" alert raised
  when they tried to invest.

  `mf_platform_opened_at` marks it done. It is set either by an employee
  ticking the client off in the CRM queue ('staff', with who), or
  automatically the first time the client's sign-on to the platform succeeds
  ('sign_on') — a successful sign-on is proof the account exists there.

  Backfilled from the sign-on log for clients who have already signed on.

  `mf_platform_opened_by` is a plain uuid, not a foreign key: a second FK from
  nw_clients to nw_employees makes PostgREST's employee embeds ambiguous.
  All three join the client self-update guard. Additive only.
*/

ALTER TABLE nw_clients
  ADD COLUMN IF NOT EXISTS mf_platform_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS mf_platform_opened_by uuid,
  ADD COLUMN IF NOT EXISTS mf_platform_opened_via text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nw_clients_mf_platform_opened_via_check') THEN
    ALTER TABLE nw_clients ADD CONSTRAINT nw_clients_mf_platform_opened_via_check
      CHECK (mf_platform_opened_via IN ('staff', 'sign_on'));
  END IF;
END $$;

UPDATE nw_clients c
   SET mf_platform_opened_at = s.first_ok,
       mf_platform_opened_via = 'sign_on'
  FROM (SELECT client_id, min(created_at) AS first_ok
          FROM nw_wylth_sso_log
         WHERE outcome = 'ok' AND client_id IS NOT NULL
         GROUP BY client_id) s
 WHERE c.id = s.client_id
   AND c.mf_platform_opened_at IS NULL;

-- The authoritative guard, replaced wholesale (see 20261112190000). Adds the
-- three columns above; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.nw_clients_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_blocked text[] := ARRAY[]::text[];
BEGIN
  -- Not an end-user request (service role / internal trigger context): allow.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- CRM staff: the existing employee/admin RLS policy already scopes which rows
  -- they may touch. Column freedom is intentional for them.
  IF EXISTS (
    SELECT 1 FROM nw_employees e
    WHERE e.auth_user_id = v_uid AND e.status = 'active'
  ) THEN
    RETURN NEW;
  END IF;

  -- Not the owning client either -- RLS should already have rejected this.
  IF OLD.client_auth_user_id IS DISTINCT FROM v_uid THEN
    RETURN NEW;
  END IF;

  -- Caller is the client acting on their own row. Identity, verification state,
  -- commercial routing and portfolio figures are server-owned.
  IF NEW.id                  IS DISTINCT FROM OLD.id                  THEN v_blocked := array_append(v_blocked, 'id'); END IF;
  IF NEW.client_code         IS DISTINCT FROM OLD.client_code         THEN v_blocked := array_append(v_blocked, 'client_code'); END IF;
  IF NEW.client_auth_user_id IS DISTINCT FROM OLD.client_auth_user_id THEN v_blocked := array_append(v_blocked, 'client_auth_user_id'); END IF;
  IF NEW.client_login_enabled IS DISTINCT FROM OLD.client_login_enabled THEN v_blocked := array_append(v_blocked, 'client_login_enabled'); END IF;
  IF NEW.created_at          IS DISTINCT FROM OLD.created_at          THEN v_blocked := array_append(v_blocked, 'created_at'); END IF;

  IF NEW.full_name           IS DISTINCT FROM OLD.full_name           THEN v_blocked := array_append(v_blocked, 'full_name'); END IF;
  IF NEW.gender              IS DISTINCT FROM OLD.gender              THEN v_blocked := array_append(v_blocked, 'gender'); END IF;
  IF NEW.email               IS DISTINCT FROM OLD.email               THEN v_blocked := array_append(v_blocked, 'email'); END IF;
  IF NEW.phone               IS DISTINCT FROM OLD.phone               THEN v_blocked := array_append(v_blocked, 'phone'); END IF;
  IF NEW.notes               IS DISTINCT FROM OLD.notes               THEN v_blocked := array_append(v_blocked, 'notes'); END IF;

  -- PAN and every verification flag: server-attested only.
  IF NEW.pan                 IS DISTINCT FROM OLD.pan                 THEN v_blocked := array_append(v_blocked, 'pan'); END IF;
  IF NEW.pan_name            IS DISTINCT FROM OLD.pan_name            THEN v_blocked := array_append(v_blocked, 'pan_name'); END IF;
  IF NEW.pan_verified        IS DISTINCT FROM OLD.pan_verified        THEN v_blocked := array_append(v_blocked, 'pan_verified'); END IF;
  IF NEW.pan_doc_uploaded    IS DISTINCT FROM OLD.pan_doc_uploaded    THEN v_blocked := array_append(v_blocked, 'pan_doc_uploaded'); END IF;
  IF NEW.phone_verified      IS DISTINCT FROM OLD.phone_verified      THEN v_blocked := array_append(v_blocked, 'phone_verified'); END IF;
  IF NEW.bank_verified       IS DISTINCT FROM OLD.bank_verified       THEN v_blocked := array_append(v_blocked, 'bank_verified'); END IF;
  IF NEW.cml_uploaded        IS DISTINCT FROM OLD.cml_uploaded        THEN v_blocked := array_append(v_blocked, 'cml_uploaded'); END IF;
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN v_blocked := array_append(v_blocked, 'verification_status'); END IF;
  IF NEW.kyc_submitted_at    IS DISTINCT FROM OLD.kyc_submitted_at    THEN v_blocked := array_append(v_blocked, 'kyc_submitted_at'); END IF;
  IF NEW.onboarding_status   IS DISTINCT FROM OLD.onboarding_status   THEN v_blocked := array_append(v_blocked, 'onboarding_status'); END IF;

  -- The registrar's KYC verdict: written by the proxy only.
  IF NEW.kra_status          IS DISTINCT FROM OLD.kra_status          THEN v_blocked := array_append(v_blocked, 'kra_status'); END IF;
  IF NEW.kra_compliant       IS DISTINCT FROM OLD.kra_compliant       THEN v_blocked := array_append(v_blocked, 'kra_compliant'); END IF;
  IF NEW.kra_active          IS DISTINCT FROM OLD.kra_active          THEN v_blocked := array_append(v_blocked, 'kra_active'); END IF;
  IF NEW.kra_checked_at      IS DISTINCT FROM OLD.kra_checked_at      THEN v_blocked := array_append(v_blocked, 'kra_checked_at'); END IF;
  IF NEW.kra_detail          IS DISTINCT FROM OLD.kra_detail          THEN v_blocked := array_append(v_blocked, 'kra_detail'); END IF;

  -- Investor profile: a regulatory declaration, stored only through
  -- public-onboard-save-profile (which validates it) or by staff.
  IF NEW.occupation          IS DISTINCT FROM OLD.occupation          THEN v_blocked := array_append(v_blocked, 'occupation'); END IF;
  IF NEW.income_slab         IS DISTINCT FROM OLD.income_slab         THEN v_blocked := array_append(v_blocked, 'income_slab'); END IF;
  IF NEW.wealth_source       IS DISTINCT FROM OLD.wealth_source       THEN v_blocked := array_append(v_blocked, 'wealth_source'); END IF;
  IF NEW.pep_status          IS DISTINCT FROM OLD.pep_status          THEN v_blocked := array_append(v_blocked, 'pep_status'); END IF;
  IF NEW.birth_place         IS DISTINCT FROM OLD.birth_place         THEN v_blocked := array_append(v_blocked, 'birth_place'); END IF;
  IF NEW.birth_country       IS DISTINCT FROM OLD.birth_country       THEN v_blocked := array_append(v_blocked, 'birth_country'); END IF;
  IF NEW.tax_resident_outside_india IS DISTINCT FROM OLD.tax_resident_outside_india THEN v_blocked := array_append(v_blocked, 'tax_resident_outside_india'); END IF;
  IF NEW.foreign_tax_country IS DISTINCT FROM OLD.foreign_tax_country THEN v_blocked := array_append(v_blocked, 'foreign_tax_country'); END IF;
  IF NEW.foreign_tax_id      IS DISTINCT FROM OLD.foreign_tax_id      THEN v_blocked := array_append(v_blocked, 'foreign_tax_id'); END IF;
  IF NEW.father_name         IS DISTINCT FROM OLD.father_name         THEN v_blocked := array_append(v_blocked, 'father_name'); END IF;
  IF NEW.spouse_name         IS DISTINCT FROM OLD.spouse_name         THEN v_blocked := array_append(v_blocked, 'spouse_name'); END IF;
  IF NEW.mobile_belongs_to   IS DISTINCT FROM OLD.mobile_belongs_to   THEN v_blocked := array_append(v_blocked, 'mobile_belongs_to'); END IF;
  IF NEW.email_belongs_to    IS DISTINCT FROM OLD.email_belongs_to    THEN v_blocked := array_append(v_blocked, 'email_belongs_to'); END IF;
  IF NEW.nomination_choice   IS DISTINCT FROM OLD.nomination_choice   THEN v_blocked := array_append(v_blocked, 'nomination_choice'); END IF;
  IF NEW.investor_profile_completed_at IS DISTINCT FROM OLD.investor_profile_completed_at THEN v_blocked := array_append(v_blocked, 'investor_profile_completed_at'); END IF;
  IF NEW.investor_profile_source IS DISTINCT FROM OLD.investor_profile_source THEN v_blocked := array_append(v_blocked, 'investor_profile_source'); END IF;
  IF NEW.investor_profile_by IS DISTINCT FROM OLD.investor_profile_by THEN v_blocked := array_append(v_blocked, 'investor_profile_by'); END IF;
  IF NEW.mandate_preference IS DISTINCT FROM OLD.mandate_preference THEN v_blocked := array_append(v_blocked, 'mandate_preference'); END IF;
  IF NEW.mandate_max_amount IS DISTINCT FROM OLD.mandate_max_amount THEN v_blocked := array_append(v_blocked, 'mandate_max_amount'); END IF;
  IF NEW.mandate_upi_id IS DISTINCT FROM OLD.mandate_upi_id THEN v_blocked := array_append(v_blocked, 'mandate_upi_id'); END IF;
  IF NEW.mf_platform_opened_at IS DISTINCT FROM OLD.mf_platform_opened_at THEN v_blocked := array_append(v_blocked, 'mf_platform_opened_at'); END IF;
  IF NEW.mf_platform_opened_by IS DISTINCT FROM OLD.mf_platform_opened_by THEN v_blocked := array_append(v_blocked, 'mf_platform_opened_by'); END IF;
  IF NEW.mf_platform_opened_via IS DISTINCT FROM OLD.mf_platform_opened_via THEN v_blocked := array_append(v_blocked, 'mf_platform_opened_via'); END IF;

  -- Commercial routing and money.
  IF NEW.employee_id         IS DISTINCT FROM OLD.employee_id         THEN v_blocked := array_append(v_blocked, 'employee_id'); END IF;
  IF NEW.dsa_id              IS DISTINCT FROM OLD.dsa_id              THEN v_blocked := array_append(v_blocked, 'dsa_id'); END IF;
  IF NEW.sourced_via         IS DISTINCT FROM OLD.sourced_via         THEN v_blocked := array_append(v_blocked, 'sourced_via'); END IF;
  IF NEW.portfolio_value     IS DISTINCT FROM OLD.portfolio_value     THEN v_blocked := array_append(v_blocked, 'portfolio_value'); END IF;
  IF NEW.bse_ucc             IS DISTINCT FROM OLD.bse_ucc             THEN v_blocked := array_append(v_blocked, 'bse_ucc'); END IF;
  IF NEW.bse_ucc_status      IS DISTINCT FROM OLD.bse_ucc_status      THEN v_blocked := array_append(v_blocked, 'bse_ucc_status'); END IF;
  IF NEW.bse_ucc_synced_at   IS DISTINCT FROM OLD.bse_ucc_synced_at   THEN v_blocked := array_append(v_blocked, 'bse_ucc_synced_at'); END IF;

  IF array_length(v_blocked, 1) > 0 THEN
    RAISE EXCEPTION 'Not permitted: % can only be changed by Niyom Wealth staff.',
      array_to_string(v_blocked, ', ')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.nw_clients_guard_self_update() FROM PUBLIC, anon, authenticated;
