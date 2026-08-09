-- Security hardening (finding 2, remainder): the other SECURITY DEFINER
-- functions reachable by `anon` over /rest/v1/rpc/*.
--
-- These do carry internal caller checks (nw_delete_lead answers "Only an admin
-- can delete a lead."), so they were not directly exploitable -- but an
-- unauthenticated role has no reason to reach a CRM RPC at all, and relying on
-- each function to police itself is one refactor away from a hole.
--
-- Verified safe before applying:
--   * every frontend caller lives under src/crm/ (authenticated staff surfaces);
--     no public/unauthenticated page invokes one.
--   * no RLS policy granted to `anon` or PUBLIC references any SECURITY DEFINER
--     function, so no policy evaluation starts failing with permission denied.
--   * `authenticated` and `service_role` retain EXECUTE.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    -- Revoke the PUBLIC grant too: it is what `anon` inherits EXECUTE through.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
