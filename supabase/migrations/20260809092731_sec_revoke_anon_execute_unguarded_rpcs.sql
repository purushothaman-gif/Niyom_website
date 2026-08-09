-- Security fix (finding 2): unauthenticated writes via SECURITY DEFINER RPCs.
--
-- Seven SECURITY DEFINER functions carry no caller authorization check yet were
-- EXECUTE-able by `anon`, i.e. reachable over /rest/v1/rpc/* with nothing but the
-- public anon key. All seven are invoked exclusively by edge functions running
-- under the service role, so revoking anon/authenticated/PUBLIC breaks no caller.
--
-- Additionally revoke anon EXECUTE on every SECURITY DEFINER *trigger* function.
-- Those are only ever fired by the trigger machinery (which runs as the function
-- owner) and were never meant to be callable over the Data API.

-- 1. The seven unguarded, service-role-only RPCs.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'nw_insert_payment',
        'nw_finalize_receipt',
        'nw_transfer_deal',
        'nw_recompute_portfolio_value',
        'nw_notify_admins',
        'delete_old_news',
        'prune_news_to_cap'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 2. Every SECURITY DEFINER trigger function in public.
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
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;
