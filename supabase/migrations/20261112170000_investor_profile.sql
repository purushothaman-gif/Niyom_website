/*
  # Investor profile — the data a mutual-fund exchange account needs

  Registering a client on BSE StAR MF (a UCC) needs more than name, PAN,
  address and bank. Until now the rest was either typed by staff into the BSE
  admin form each time and never saved, or sent as fixed defaults — including
  the FATCA declaration (occupation, income, source of wealth, politically
  exposed status), which goes out marked as the investor's own declaration.

  This stores what the investor actually declares, collected in onboarding.

  ## Values are our own, not BSE's

  The columns hold plain keys ('service', '5l_10l', 'salary'…), not BSE codes.
  BSE's code lists are not in this repository and differ between its file and
  API specs, so the mapping to codes belongs in the proxy mapper, where it can
  be corrected without touching client data.

  ## Who writes

  Every column here except `bank_account_type` is written by the
  public-onboard-save-profile edge function (service role) after validation,
  and by staff. They are added to the client self-update guard so a client
  session cannot write them directly — a declaration should only be stored
  through the path that validates it and stamps `investor_profile_completed_at`.

  The guard also gains the `kra_*` columns. They are the registrar's KYC
  verdict, written by the proxy, and were writable by the client's own session.

  Additive only.
*/

ALTER TABLE nw_clients
  ADD COLUMN IF NOT EXISTS bank_account_type text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS income_slab text,
  ADD COLUMN IF NOT EXISTS wealth_source text,
  ADD COLUMN IF NOT EXISTS pep_status text,
  ADD COLUMN IF NOT EXISTS birth_place text,
  ADD COLUMN IF NOT EXISTS birth_country text,
  ADD COLUMN IF NOT EXISTS tax_resident_outside_india boolean,
  ADD COLUMN IF NOT EXISTS foreign_tax_country text,
  ADD COLUMN IF NOT EXISTS foreign_tax_id text,
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS spouse_name text,
  ADD COLUMN IF NOT EXISTS mobile_belongs_to text,
  ADD COLUMN IF NOT EXISTS email_belongs_to text,
  ADD COLUMN IF NOT EXISTS nomination_choice text,
  ADD COLUMN IF NOT EXISTS investor_profile_completed_at timestamptz;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('nw_clients_bank_account_type_check', $q$bank_account_type IN ('savings','current','nre','nro')$q$),
      ('nw_clients_occupation_check', $q$occupation IN ('private_sector_service','public_sector_service','government_service','business','professional','agriculturist','retired','housewife','student','others')$q$),
      ('nw_clients_income_slab_check', $q$income_slab IN ('below_1l','1l_5l','5l_10l','10l_25l','25l_1cr','above_1cr')$q$),
      ('nw_clients_wealth_source_check', $q$wealth_source IN ('salary','business','gift','ancestral_property','rental_income','prize_money','royalty','others')$q$),
      ('nw_clients_pep_status_check', $q$pep_status IN ('no','yes','related')$q$),
      ('nw_clients_mobile_belongs_to_check', $q$mobile_belongs_to IN ('self','spouse','dependent_children','dependent_siblings','dependent_parents','guardian')$q$),
      ('nw_clients_email_belongs_to_check', $q$email_belongs_to IN ('self','spouse','dependent_children','dependent_siblings','dependent_parents','guardian')$q$),
      ('nw_clients_nomination_choice_check', $q$nomination_choice IN ('nominate','opt_out')$q$)
    ) AS t(name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE nw_clients ADD CONSTRAINT %I CHECK (%s)', c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- Nominees: what the exchange asks for beyond name, relationship and share.
-- An Aadhaar is never stored in full — only its last four digits.
ALTER TABLE nw_client_nominees
  ADD COLUMN IF NOT EXISTS id_type text,
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS guardian_dob date,
  ADD COLUMN IF NOT EXISTS guardian_pan text,
  ADD COLUMN IF NOT EXISTS guardian_relationship text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nw_client_nominees_id_type_check') THEN
    ALTER TABLE nw_client_nominees
      ADD CONSTRAINT nw_client_nominees_id_type_check
      CHECK (id_type IN ('pan','aadhaar_last4','passport','driving_licence'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nw_client_nominees_aadhaar_last4_check') THEN
    ALTER TABLE nw_client_nominees
      ADD CONSTRAINT nw_client_nominees_aadhaar_last4_check
      CHECK (id_type IS DISTINCT FROM 'aadhaar_last4' OR id_number ~ '^[0-9]{4}$');
  END IF;
END $$;

-- The authoritative guard, replaced wholesale (see 20260809092943). Adds the
-- investor-profile columns and kra_*; everything else is unchanged.
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
