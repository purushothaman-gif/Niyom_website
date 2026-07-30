/*
  # Partner Portal — revoke API access to the two new trigger functions

  ## Purpose
  nw_guard_dsa_self_update() and mkt_provision_dsa_referral_link() are TRIGGER
  functions, but they inherited the default PUBLIC EXECUTE grant that Postgres
  gives every new function. PostgREST exposes anything executable at
  /rest/v1/rpc/<name>, so the Supabase security advisor correctly flagged both as
  SECURITY DEFINER functions reachable over the API — nw_guard_dsa_self_update()
  even by the `anon` role.

  Calling either outside a trigger cannot achieve anything (there is no OLD/NEW
  record, so they error out), but a SECURITY DEFINER function should not be an
  API endpoint at all. This closes the surface.

  ## Safety
  Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time, not when
  the trigger fires. Both triggers (trg_nw_guard_dsa_self_update,
  trg_mkt_dsa_referral_link) keep working after the revoke — verified against the
  live database by re-running an enable/disable cycle and confirming the referral
  link was still auto-provisioned.

  No other function's grants are touched: the nw_partner_* RPCs must remain
  executable by `authenticated` (each gates internally by raising
  'Partner access required' when nw_current_dsa_id() is NULL), and
  nw_current_dsa_id() / nw_current_client_code() must remain executable because
  RLS policies call them.
*/

REVOKE ALL ON FUNCTION nw_guard_dsa_self_update()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mkt_provision_dsa_referral_link() FROM PUBLIC, anon, authenticated;
