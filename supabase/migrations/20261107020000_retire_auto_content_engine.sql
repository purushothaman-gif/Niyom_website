-- =============================================================================
-- Retire the AUTO content engine (2026-11-07, owner's decision)
--
-- The 3-posts-a-day pipeline (plan → Claude generation → GitHub Actions render)
-- failed too often to rely on: 6 posts in the last 30 days against ~90 planned.
-- Content moves to Canva. This only STOPS THE SCHEDULES — tables, functions,
-- edge functions, the render workflow and every past post stay, so it can be
-- re-enabled by re-running the cron.schedule calls in
-- 20260812120000_mkt_auto_generate_cron.sql and its sibling mkt_* migrations.
--
-- Kept: mkt-expire-content — it enforces the 48h hard expiry on content staff
-- create by hand in AI Content Creation, which is not part of the auto engine.
-- =============================================================================
do $$
declare v_job bigint;
begin
  for v_job in
    select jobid from cron.job
    where jobname in (
      'mkt-auto-plan',
      'mkt-auto-generate',
      'mkt-auto-generate-late',
      'mkt-render-dispatch',
      'mkt-render-dispatch-retry',
      'mkt-auto-health-check'
    )
  loop
    perform cron.unschedule(v_job);
  end loop;
end $$;
