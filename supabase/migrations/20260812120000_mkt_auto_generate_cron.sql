/*
  # Automated daily content — the generation schedule

  Fires mkt-auto-generate repeatedly across a window rather than once, because
  the function is deliberately deadline-bounded: three sequential Anthropic
  calls at effort:medium run 20-45s each and a corrective retry pushes past
  200s, which is too long for one comfortable invocation. Each tick claims at
  most two slots and returns; once the day's three are done every remaining
  tick is a no-op that claims nothing.

  ## Timing

  02:30-02:55 UTC = 08:00-08:25 IST. That sits ten minutes after the planner
  (02:20 UTC / 07:50 IST) and finishes well before the render worker starts at
  08:50 IST, which in turn finishes before the 09:30 IST publish gate.

  A second, later pair at 03:00 and 03:10 UTC covers an Anthropic blip during
  the first window. Beyond that the batch is left partial and admins are
  alerted — no fabricated fallback and no reposting yesterday's content, both
  of which are worse than a gap.

  Slots verified free against every existing job (23:45, 00:00, 01:00, 01:30,
  02:00 x3, 02:15, 02:20, plus the every-10-minute and every-15-minute jobs).
  (Written out in words rather than as cron syntax on purpose: an asterisk
  followed by a slash inside this comment would close it early.)

  ## Auth

  Vault pattern, copied from 20260810140000_mf_returns_backfill_cron.sql. The
  secret is created out of band and is deliberately not in version control; it
  must match the MKT_AUTO_SECRET function secret. The project URL is hardcoded
  because the app.settings.* GUCs this project once used are not configured on
  the hosted instance and silently post to a null URL.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_mkt_auto_generate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'mkt_auto_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'mkt_auto_secret is not in the vault — the auto content batch cannot authenticate';
  END IF;

  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/mkt-auto-generate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mkt-auto-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_mkt_auto_generate() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.trigger_mkt_auto_generate() IS
  'Invokes mkt-auto-generate with the vault-held shared secret. Called only by pg_cron.';

SELECT cron.unschedule('mkt-auto-generate')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mkt-auto-generate');

SELECT cron.unschedule('mkt-auto-generate-late')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mkt-auto-generate-late');

-- Primary window: 08:00-08:25 IST.
SELECT cron.schedule('mkt-auto-generate', '30,35,40,45,50,55 2 * * *',
  $$SELECT trigger_mkt_auto_generate()$$);

-- Recovery window: 08:30 and 08:40 IST, still ahead of the render worker.
SELECT cron.schedule('mkt-auto-generate-late', '0,10 3 * * *',
  $$SELECT trigger_mkt_auto_generate()$$);
