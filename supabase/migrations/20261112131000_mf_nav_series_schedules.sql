-- Schedules for mf_nav_series (see 20261112130000_mf_nav_series.sql).
--
--   mf-nav-series-load    every minute; a no-op unless the queue has work, and
--                         bulk loading pauses in Indian business hours.
--   mf-nav-series-append  00:30 UTC, after nav-refresh-daily (23:45 UTC) has
--                         put the day's AMFI NAVs into nav_daily.
--   mf-nav-series-seed    01:00 UTC; queues schemes that are new to the site.

do $$
begin
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('mf-nav-series-load', 'mf-nav-series-append', 'mf-nav-series-seed');
  perform cron.schedule('mf-nav-series-load', '* * * * *', 'select public.mf_nav_series_tick()');
  perform cron.schedule('mf-nav-series-append', '30 0 * * *', 'select public.mf_nav_series_append()');
  perform cron.schedule('mf-nav-series-seed', '0 1 * * *', 'select public.mf_nav_series_seed()');
end $$;
