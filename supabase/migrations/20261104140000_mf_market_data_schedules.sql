-- MF market data — Phase 1 schedules (approved 2026-11-04).
-- Same pattern as trigger_nav_refresh: hard-coded URL (the app.settings.* GUCs
-- are unset on this project) and the nav_refresh_secret from the vault.

create or replace function public.trigger_mf_market_data(p_function text, p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if p_function not in ('nav-backfill', 'mf-market-data') then
    raise exception 'trigger_mf_market_data: unknown function %', p_function;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'nav_refresh_secret';
  if v_secret is null then
    raise exception 'nav_refresh_secret is not in the vault';
  end if;
  perform net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-nav-secret', v_secret),
    body := p_body,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke all on function public.trigger_mf_market_data(text, jsonb) from public, anon, authenticated;

-- Full NAV history: one week per minute, newest first, until 01-Apr-2006
-- (~1,070 weeks ≈ 18 hours). Once the floor is reached each call returns
-- {done:true} immediately; the job can then be unscheduled.
select cron.schedule('nav-history-backfill', '* * * * *',
  $$select public.trigger_mf_market_data('nav-backfill', '{"mode":"history"}'::jsonb)$$);

-- AMFI scheme master, daily 02:00 IST.
select cron.schedule('mf-scheme-master', '30 20 * * *',
  $$select public.trigger_mf_market_data('mf-market-data', '{"action":"master"}'::jsonb)$$);

-- Health check + email alert, daily 09:00 IST (after the 05:15 IST NAV refresh).
select cron.schedule('mf-market-data-health', '30 3 * * *',
  $$select public.trigger_mf_market_data('mf-market-data', '{"action":"health"}'::jsonb)$$);
