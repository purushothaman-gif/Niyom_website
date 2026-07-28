/*
  # Marketing Tool — tighten EXECUTE grants on the module's functions

  Follow-up to 20260729120000 / 20260729120100, flagged by the Supabase security
  advisor (anon_security_definer_function_executable).

  ## Why "REVOKE ALL FROM PUBLIC" was not enough
  Supabase configures DEFAULT PRIVILEGES that grant EXECUTE on every new
  public-schema function to anon, authenticated and service_role EXPLICITLY.
  Revoking from PUBLIC removes only the PUBLIC entry, so anon kept a direct
  grant on the new SECURITY DEFINER functions. Each role has to be named.

  ## What changes
  - mkt_set_content_status — admin-only RPC. It already re-checks
    nw_current_emp_is_admin() internally (verified: a plain employee calling it
    raises "Only admins can change content status"), but anon should not reach a
    SECURITY DEFINER function at all. authenticated keeps EXECUTE — the CRM
    calls this to approve/reject/archive.
  - mkt_provision_referral_link, mkt_touch_updated_at — TRIGGER functions.
    Postgres does not check EXECUTE when firing a trigger, so revoking from all
    client roles is safe and removes them from the REST RPC surface entirely.
  - mkt_generate_ref_code — only ever evaluated as a column DEFAULT during
    service-role or trigger inserts. mkt_referral_links has no client INSERT
    policy, so no client role needs it.
  - mkt_next_content_no — evaluated as the mkt_content.content_no DEFAULT when
    an ADMIN inserts from the CRM, so authenticated MUST keep EXECUTE. anon
    loses it (calling it would only burn sequence values).

  Verified after applying: an admin can still insert content (content_no is
  generated) and still approve it (expires_at is set).

  ## Safety
  Idempotent — REVOKE of an already-absent privilege is a no-op.
*/

REVOKE EXECUTE ON FUNCTION mkt_set_content_status(uuid, text, text) FROM anon;

REVOKE EXECUTE ON FUNCTION mkt_provision_referral_link() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION mkt_touch_updated_at()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION mkt_generate_ref_code()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION mkt_next_content_no()         FROM PUBLIC, anon;
