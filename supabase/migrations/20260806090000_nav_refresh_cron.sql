/*
  # Nightly NAV refresh, moved from the droplet to an Edge Function

  The droplet exists for a whitelisted static IP that BSE StAR MF and the
  Cashfree relay require. This job never needed one — AMFI's NAVAll.txt is a
  public, unauthenticated file — so it was only there because that was the
  server that existed.

  ## Why the secret is in Vault

  Every other trigger_* function in this project hardcodes its URL and sends no
  auth, because the functions they call are open. nav-refresh is not: it
  requires NAV_REFRESH_SECRET. Writing that literal into the function body would
  put it in pg_proc, which any authenticated role can read — so it lives in
  Vault, where they cannot. Verified: the secret does not appear in
  pg_get_functiondef() output.

  Worst case if it leaked is small — a caller could force an AMFI fetch and an
  upsert of public market data, with no client data reachable — but "small" is
  not a reason to publish a credential.

  ## Timing

  23:45 UTC = 05:15 IST, long after AMFI publishes. Offset 15 minutes from the
  droplet's own 23:30 job, which keeps running until the CAS migration is
  finished. Both writing is harmless: every write is an upsert on
  (isin, nav_date). There is simply no reason to have them collide.

  NOTE: the vault secret itself is created out-of-band (it is a credential and
  does not belong in version control). This migration assumes a secret named
  'nav_refresh_secret' exists and fails loudly at run time if it does not.
*/

CREATE OR REPLACE FUNCTION public.trigger_nav_refresh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'nav_refresh_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'nav_refresh_secret is not in the vault — the NAV refresh cannot authenticate';
  END IF;

  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/nav-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nav-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_nav_refresh() FROM PUBLIC;

COMMENT ON FUNCTION public.trigger_nav_refresh IS
  'Calls the nav-refresh Edge Function with the Vault-held trigger secret. Scheduled nightly by pg_cron.';

/* Idempotent: unschedule first so re-running the migration does not duplicate. */
SELECT cron.unschedule('nav-refresh-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nav-refresh-daily');

SELECT cron.schedule('nav-refresh-daily', '45 23 * * *', 'SELECT trigger_nav_refresh()');
