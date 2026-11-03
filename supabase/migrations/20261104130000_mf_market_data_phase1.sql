-- =============================================================================
-- MF market data — Phase 1 (approved 2026-11-04)
--
-- One central, AMFI-sourced mutual-fund database, built by EXTENDING what already
-- exists rather than adding parallel tables:
--
--   nav_daily        stays the single NAV store (ISIN x date). Full history is
--                    backfilled into it from AMFI's historical NAV report.
--   mf_asset_class   (ISIN-keyed, already filled nightly) becomes the scheme
--                    master: AMC, plan, option, SEBI category, type, launch/
--                    closure, minimum amount — from AMFI's scheme-data file.
--   mf_scheme_cache  keeps trailing returns; gains 1M / 3M, and records whether
--                    a figure came from our own NAV history or mfapi.in.
--   nav_refresh_log  becomes the single job log for every market-data job
--                    (daily, history, master, health) instead of a second table.
--
-- Market data only. Client holdings (nw_holdings, mf_rta_*, cas_*) and the
-- Wylth SSO path are not touched.
--
-- Additive except one statement: idx_nav_daily_isin_date is dropped because it
-- duplicates the (isin, nav_date) primary key — a btree serves both scan
-- directions — and with full history it would cost ~1.5 GB for nothing.
-- =============================================================================

-- 1. Scheme master columns on mf_asset_class ----------------------------------
alter table public.mf_asset_class
  add column if not exists amc_name          text,
  add column if not exists scheme_base_name  text,
  add column if not exists scheme_type       text,     -- Open Ended / Close Ended / Interval Fund
  add column if not exists sebi_category     text,     -- e.g. "Equity Scheme - Large Cap Fund"
  add column if not exists plan              text,     -- Regular / Direct
  add column if not exists scheme_option     text,     -- Growth / IDCW / Bonus
  add column if not exists min_amount        numeric,
  add column if not exists launch_date       date,
  add column if not exists closure_date      date,
  add column if not exists master_synced_at  timestamptz;

comment on column public.mf_asset_class.sebi_category is
  'AMFI scheme-data file "Scheme Category" (SEBI category - sub-category). Refreshed daily by mf-market-data/master.';
comment on column public.mf_asset_class.master_synced_at is
  'Last time AMFI''s scheme-data file listed this ISIN.';

create index if not exists idx_mf_asset_class_amfi_code on public.mf_asset_class (amfi_code);

-- 2. Returns: 1M / 3M and provenance -----------------------------------------
alter table public.mf_scheme_cache
  add column if not exists return_1m      numeric,
  add column if not exists return_3m      numeric,
  add column if not exists returns_source text;   -- 'nav_daily' | 'mfapi'

-- 3. One job log for all market-data jobs ------------------------------------
alter table public.nav_refresh_log
  add column if not exists job         text not null default 'daily',  -- daily | history | master | health
  add column if not exists window_from date,
  add column if not exists window_to   date,
  add column if not exists details     jsonb;

create index if not exists idx_nav_refresh_log_job on public.nav_refresh_log (job, started_at desc);
create index if not exists idx_nav_refresh_log_history_window
  on public.nav_refresh_log (window_from) where job = 'history';

-- 4. Drop the index that duplicates nav_daily's primary key -------------------
drop index if exists public.idx_nav_daily_isin_date;

-- 5. History backfill cursor --------------------------------------------------
-- Oldest date the backfill has settled (fetched OK, or skipped after repeated
-- failures — a skip is logged and surfaced by the health view, never silent).
-- NULL until the first window lands.
create or replace function public.mf_nav_history_cursor()
returns date
language sql stable
set search_path = public
as $$
  select min(window_from)
  from nav_refresh_log
  where job = 'history'
    and (ok or coalesce((details->>'skipped')::boolean, false));
$$;

-- AMFI's historical NAV report begins on 01-Apr-2006.
create or replace function public.mf_nav_history_floor()
returns date language sql immutable as $$ select date '2006-04-01' $$;

-- 6. A scheme's full NAV history from nav_daily, in the shape computeAll reads -
-- (newest first, {date:"dd-mm-yyyy", nav:"..."}), plus whether we hold ALL of it.
-- `complete` = the backfill has reached below the scheme's first NAV, so its
-- since-inception and long-period returns can be computed locally.
-- Returned as one jsonb value so PostgREST's row cap does not truncate it.
create or replace function public.mf_scheme_nav_history(p_scheme_code text)
returns jsonb
language sql stable
set search_path = public
as $$
  with isin as (
    select a.isin
    from mf_asset_class a
    where a.amfi_code = p_scheme_code
      and exists (select 1 from nav_daily n where n.isin = a.isin)
    order by a.isin
    limit 1
  ),
  pts as (
    select n.nav_date, n.nav
    from nav_daily n
    where n.isin = (select isin from isin) and n.nav > 0
  ),
  bounds as (select min(nav_date) as first_date, max(nav_date) as last_date, count(*) as n from pts),
  cur as (select public.mf_nav_history_cursor() as c)
  select jsonb_build_object(
    'isin', (select isin from isin),
    'first_date', b.first_date,
    'last_date', b.last_date,
    'count', b.n,
    'complete', b.first_date is not null and cur.c is not null
                and (cur.c <= public.mf_nav_history_floor() or b.first_date > cur.c + 7),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(nav_date, 'DD-MM-YYYY'), 'nav', nav::text)
                       order by nav_date desc)
      from pts), '[]'::jsonb)
  )
  from bounds b, cur;
$$;

-- 7. Day-over-day validation of a NAV date -----------------------------------
create or replace function public.mf_nav_validate(p_date date)
returns jsonb
language sql stable
set search_path = public
as $$
  with today as (select isin, nav from nav_daily where nav_date = p_date),
  -- The last FULL trading day: weekends/holidays carry only a few hundred
  -- liquid-fund NAVs and would make every other scheme look "missing".
  prev_date as (
    select nav_date d from (
      select nav_date, count(*) c from nav_daily
      where nav_date < p_date and nav_date > p_date - 10 group by nav_date
    ) x
    where c >= 0.5 * (select count(*) from today)
    order by nav_date desc limit 1
  ),
  prev as (select isin, nav from nav_daily where nav_date = (select d from prev_date)),
  moves as (
    select t.isin, t.nav, p.nav as prev_nav, abs(t.nav / nullif(p.nav, 0) - 1) as mv
    from today t join prev p using (isin)
  )
  select jsonb_build_object(
    'nav_date', p_date,
    'rows', (select count(*) from today),
    'prev_date', (select d from prev_date),
    'prev_rows', (select count(*) from prev),
    'missing_vs_prev', (select count(*) from prev where isin not in (select isin from today)),
    'big_moves', (select count(*) from moves where mv > 0.20),
    'big_move_sample', (select coalesce(jsonb_agg(jsonb_build_object('isin', isin, 'nav', nav, 'prev', prev_nav)), '[]'::jsonb)
                        from (select * from moves where mv > 0.20 order by mv desc limit 10) s)
  );
$$;

-- 8. Health at a glance (staff read; the alert job emails on problems) --------
create or replace view public.mf_market_data_health
with (security_invoker = true) as
with last_daily as (
  select * from nav_refresh_log where job = 'daily' order by started_at desc limit 1
),
last_ok_daily as (
  select max(finished_at) at from nav_refresh_log where job = 'daily' and ok
),
latest as (select max(nav_date) d from nav_daily where nav_date > current_date - 30),
counts as (
  select nav_date, count(*) n from nav_daily
  where nav_date > current_date - 14 group by nav_date
)
select
  (select d from latest)                                                     as latest_nav_date,
  current_date - (select d from latest)                                      as nav_age_days,
  (select n from counts where nav_date = (select d from latest))             as latest_nav_rows,
  (select percentile_cont(0.5) within group (order by n)::int from counts)   as median_nav_rows_14d,
  (select ok from last_daily)                                                as last_daily_ok,
  (select error from last_daily)                                             as last_daily_error,
  (select details from last_daily)                                           as last_daily_validation,
  (select at from last_ok_daily)                                             as last_daily_ok_at,
  public.mf_nav_history_cursor()                                             as history_cursor,
  public.mf_nav_history_floor()                                              as history_floor,
  (select count(*) from nav_refresh_log where job = 'history' and not ok
     and not coalesce((details->>'skipped')::boolean, false)
     and started_at > now() - interval '24 hours')                           as history_failures_24h,
  (select count(*) from nav_refresh_log where job = 'history'
     and coalesce((details->>'skipped')::boolean, false))                    as history_windows_skipped,
  (select max(finished_at) from nav_refresh_log where job = 'master' and ok) as master_synced_at,
  (select count(*) from mf_scheme_cache
     where nav_date >= current_date - 15
       and (returns_synced_at is null or returns_synced_at < now() - interval '3 days')) as returns_stale,
  (select count(*) from mf_scheme_cache where returns_source = 'nav_daily')  as returns_from_nav_daily;

-- Functions default to EXECUTE for PUBLIC, and revoking from anon alone leaves
-- that grant in place — revoke from PUBLIC first, then grant deliberately.
revoke all on function public.mf_nav_history_cursor()     from public, anon;
revoke all on function public.mf_nav_history_floor()      from public, anon;
revoke all on function public.mf_scheme_nav_history(text) from public, anon;
revoke all on function public.mf_nav_validate(date)       from public, anon;
grant execute on function public.mf_nav_history_cursor()     to authenticated, service_role;
grant execute on function public.mf_nav_history_floor()      to authenticated, service_role;
grant execute on function public.mf_scheme_nav_history(text) to authenticated, service_role;
grant execute on function public.mf_nav_validate(date)       to authenticated, service_role;

revoke all on public.mf_market_data_health from anon;
grant select on public.mf_market_data_health to authenticated, service_role;
