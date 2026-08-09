-- Fixes `v_blocked || 'col'`, which Postgres resolves as anyarray || anyarray and
-- fails on the unknown-typed literal. array_append is unambiguous. The guard was
-- already failing closed; this makes it reject with the intended message.
--
-- This is the authoritative definition of the guard: it replaces the function
-- wholesale, so replaying the previous migration and this one converges here.
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
