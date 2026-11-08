-- mf_market_data_health v2 — two false alarms fixed (2026-11-08).
--
-- 1. Weekends. AMFI publishes NAVs for a few hundred liquid/overnight schemes on
--    Saturdays and Sundays, so the newest calendar date (e.g. Sun 8-Nov: 750
--    ISINs) looked like a "partial file" against a ~12k weekday median. The
--    freshness and row-count checks now use the latest FULL trading day — a date
--    carrying at least half the 14-day weekday median. The raw newest date is
--    still exposed as latest_calendar_nav_date.
--
-- 2. Retired universe backfill. Since 2026-11-07 NAV history is loaded on
--    demand (mf_nav_tracked), not by walking every scheme back to 2006. The old
--    history_* columns described that retired job's leftovers ("8 weeks
--    skipped"); they are now constant zero and the health job reads the
--    tracker instead:
--      tracked_funds / tracked_loaded         coverage
--      tracked_gave_up_24h                    funds whose history load gave up
--                                             in the last 24h (attempts spent)
--      tracked_waiting_over_1d                tracked >1 day, still not loaded,
--                                             still being retried
--    Funds that gave up earlier are NOT re-reported daily — they are known.
--
-- Column order/types of the existing columns are unchanged (CREATE OR REPLACE
-- VIEW only allows appending), so the deployed health function keeps working.

create or replace view public.mf_market_data_health
with (security_invoker = true) as
with last_daily as (
  select * from nav_refresh_log where job = 'daily' order by started_at desc limit 1
),
last_ok_daily as (
  select max(finished_at) at from nav_refresh_log where job = 'daily' and ok
),
counts as (
  select nav_date, count(*) n from nav_daily
  where nav_date > current_date - 14 group by nav_date
),
weekday_median as (
  select percentile_cont(0.5) within group (order by n)::int m
  from counts where extract(isodow from nav_date) < 6
),
latest_full as (
  select max(nav_date) d from counts, weekday_median
  where counts.n >= 0.5 * weekday_median.m
),
tracked as (
  select
    count(*)                                                        as funds,
    count(*) filter (where history_loaded_at is not null)           as loaded,
    count(*) filter (where history_loaded_at is null and attempts >= 6
                       and last_attempt_at > now() - interval '24 hours') as gave_up_24h,
    count(*) filter (where history_loaded_at is null and attempts < 6
                       and first_seen_at < now() - interval '1 day') as waiting_over_1d
  from mf_nav_tracked
)
select
  (select d from latest_full)                                                as latest_nav_date,
  current_date - (select d from latest_full)                                 as nav_age_days,
  (select n from counts where nav_date = (select d from latest_full))        as latest_nav_rows,
  (select m from weekday_median)                                             as median_nav_rows_14d,
  (select ok from last_daily)                                                as last_daily_ok,
  (select error from last_daily)                                             as last_daily_error,
  (select details from last_daily)                                           as last_daily_validation,
  (select at from last_ok_daily)                                             as last_daily_ok_at,
  public.mf_nav_history_cursor()                                             as history_cursor,
  public.mf_nav_history_floor()                                              as history_floor,
  0::bigint                                                                  as history_failures_24h,
  0::bigint                                                                  as history_windows_skipped,
  (select max(finished_at) from nav_refresh_log where job = 'master' and ok) as master_synced_at,
  (select count(*) from mf_scheme_cache
     where nav_date >= current_date - 15
       and (returns_synced_at is null or returns_synced_at < now() - interval '3 days')) as returns_stale,
  (select count(*) from mf_scheme_cache where returns_source = 'nav_daily')  as returns_from_nav_daily,
  (select max(nav_date) from counts)                                         as latest_calendar_nav_date,
  (select funds from tracked)                                                as tracked_funds,
  (select loaded from tracked)                                               as tracked_loaded,
  (select gave_up_24h from tracked)                                          as tracked_gave_up_24h,
  (select waiting_over_1d from tracked)                                      as tracked_waiting_over_1d;

revoke all on public.mf_market_data_health from anon;
grant select on public.mf_market_data_health to authenticated, service_role;
