-- Supabase load trim, 2026-11-05.
--
-- 1. The NAV history backfill switches itself off once it reaches AMFI's
--    floor (01-Apr-2006). Until now the job had to be unscheduled by hand, and
--    left alone it would keep calling the edge function 60 times a night for
--    nothing. The job is paused (active = false), not deleted, so it can be
--    re-enabled if a later re-run is ever wanted.
create or replace function public.mf_nav_history_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur date := public.mf_nav_history_cursor();
  v_job bigint;
begin
  if v_cur is not null and v_cur <= public.mf_nav_history_floor() then
    select jobid into v_job from cron.job where jobname = 'nav-history-backfill';
    if v_job is not null then
      perform cron.alter_job(v_job, active := false);
    end if;
    return;
  end if;
  perform public.trigger_mf_market_data('nav-backfill', '{"mode":"history"}'::jsonb);
end;
$$;

revoke all on function public.mf_nav_history_tick() from public, anon, authenticated;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'nav-history-backfill'),
  command := 'select public.mf_nav_history_tick()'
);

-- 2. The CRM alert bell asks for an employee's UNREAD alerts, newest first,
--    every minute in every open tab. The only index was employee_id, so each
--    poll read the employee's whole alert history and sorted it. This partial
--    index holds unread rows only and is already in the order asked for.
create index if not exists idx_nw_alerts_unread
  on public.nw_alerts (employee_id, created_at desc)
  where read = false;
