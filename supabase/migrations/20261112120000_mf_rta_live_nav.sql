-- Registrar-fed MF holdings priced at the latest AMFI NAV (2026-11-12).
--
-- WHY. Clients saw some funds at a current NAV and others days behind. Every
-- holding keyed by ISIN (CAS, console) is priced from nav_daily, which the
-- nightly AMFI refresh keeps current. Registrar holdings (mf_rta_holdings) are
-- not: CAMS WBR9 carries no ISIN, so every surface showed the registrar's own
-- NAV/value from the last mailback — CAMS a few days old, KFintech older still
-- (its NAV lags even its own snapshot date: Mirae Large Cap 106.43 vs 115.56).
-- The board's name-match enrichment found the right AMFI scheme but only used
-- it for the 1-day move; the price and value stayed the registrar's.
--
-- WHAT.
--   isin            resolved once per row from the scheme name (the same
--                   mf_isins_for_scheme_name matcher that feeds mf_nav_tracked),
--                   disambiguated by the registrar's own NAV.
--   live_nav,
--   live_nav_date,
--   live_value      the newer of (AMFI NAV for that ISIN, registrar NAV) and
--                   units × that NAV. Registrar columns (nav, nav_value,
--                   rta_value, snapshot_date) are left untouched as evidence.
-- Kept current by a BEFORE trigger (every ingest) and an hourly cron
-- (mf-rta-reprice) that picks up each night's AMFI file. Readers use
-- coalesce(live_value, rta_value, nav_value).
--
-- Guard: mf_market_data_health gains held_stale_navs / held_stale_sample — live
-- client holdings whose price is more than 3 days behind the latest full AMFI
-- day — which the daily health email reports. Appended columns only.

alter table public.mf_rta_holdings
  add column if not exists isin          text,
  add column if not exists live_nav      numeric,
  add column if not exists live_nav_date date,
  add column if not exists live_value    numeric;

comment on column public.mf_rta_holdings.isin is
  'AMFI ISIN resolved from scheme_name (mf_rta_resolve_isin); null = unresolved.';
comment on column public.mf_rta_holdings.live_value is
  'units x newest of AMFI/registrar NAV. Readers: coalesce(live_value, rta_value, nav_value).';

-- Name -> ISIN. Candidates are the exact name-key matches; the one whose NAV
-- on/before the snapshot is closest to the registrar NAV wins (>20% off = a
-- different scheme). With no registrar NAV, only an unambiguous match is taken.
create or replace function public.mf_rta_resolve_isin(p_name text, p_nav numeric, p_date date)
returns text
language sql stable
set search_path = public
as $$
  with c as (
    select i.isin,
           (select d.nav from nav_daily d
             where d.isin = i.isin
               and d.nav_date <= coalesce(p_date, current_date)
             order by d.nav_date desc limit 1) as nav
    from public.mf_isins_for_scheme_name(p_name) as i(isin)
  ),
  priced as (select * from c where nav is not null and nav > 0)
  select isin from priced
  where (p_nav is null or p_nav <= 0 or abs(nav / p_nav - 1) <= 0.20)
    and (p_nav > 0 or (select count(*) from priced) = 1)
  order by case when p_nav > 0 then abs(nav / p_nav - 1) end nulls last, isin
  limit 1;
$$;

-- Newest price for a holding: AMFI's latest NAV for the ISIN when it is at
-- least as new as the registrar snapshot (or the registrar sent no NAV),
-- otherwise the registrar's own NAV.
create or replace function public.mf_rta_live_quote(
  p_isin text, p_feed_nav numeric, p_snapshot date,
  out nav numeric, out nav_date date)
language plpgsql stable
set search_path = public
as $$
declare
  a_nav numeric; a_date date;
begin
  if p_isin is not null then
    select d.nav, d.nav_date into a_nav, a_date
    from nav_daily d where d.isin = p_isin
    order by d.nav_date desc limit 1;
  end if;
  if a_nav > 0 and (p_feed_nav is null or p_snapshot is null or a_date >= p_snapshot) then
    nav := a_nav; nav_date := a_date;
  elsif p_feed_nav > 0 then
    nav := p_feed_nav; nav_date := p_snapshot;
  end if;
end;
$$;

create or replace function public.mf_rta_holdings_live_nav()
returns trigger
language plpgsql
set search_path = public
as $$
declare q record;
begin
  begin
    if tg_op = 'INSERT' or new.isin is null
       or new.scheme_name is distinct from old.scheme_name then
      new.isin := public.mf_rta_resolve_isin(new.scheme_name, new.nav, new.snapshot_date);
    end if;
    select * into q from public.mf_rta_live_quote(new.isin, new.nav, new.snapshot_date);
    new.live_nav      := q.nav;
    new.live_nav_date := q.nav_date;
    new.live_value    := case when q.nav is not null then round(coalesce(new.units, 0) * q.nav, 2) end;
  exception when others then
    -- Pricing must never block a registrar import.
    raise warning 'mf_rta_holdings_live_nav: %', sqlerrm;
  end;
  return new;
end;
$$;

-- "zz" so it runs after trg_mf_rta_holdings_keep_newest (BEFORE triggers fire
-- in name order) and prices the row that will actually be stored.
drop trigger if exists trg_mf_rta_holdings_zz_live_nav on public.mf_rta_holdings;
create trigger trg_mf_rta_holdings_zz_live_nav
  before insert or update on public.mf_rta_holdings
  for each row execute function public.mf_rta_holdings_live_nav();

-- Hourly: reprice every live holding against the newest nav_daily. Touches only
-- rows whose price would change (tens of rows), so it is cheap and idempotent.
create or replace function public.mf_rta_reprice()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update mf_rta_holdings h
     set isin = coalesce(h.isin, public.mf_rta_resolve_isin(h.scheme_name, h.nav, h.snapshot_date))
   where h.units > 0
     and (h.isin is null
          or h.live_nav_date is null
          or h.live_nav_date < (select max(d.nav_date) from nav_daily d where d.isin = h.isin));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mf_rta_reprice() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mf-rta-reprice') then
    perform cron.unschedule('mf-rta-reprice');
  end if;
  perform cron.schedule('mf-rta-reprice', '25 * * * *', 'select public.mf_rta_reprice()');
end $$;

-- Partner portal: value a sourced client's registrar funds at the live price.
-- invested = current on purpose (registrar MF has no cost basis here).
create or replace function public.nw_partner_client_mf(p_client_id uuid)
returns table(holding_id uuid, product_type text, product_name text, quantity numeric,
              avg_price numeric, invested_amount numeric, current_value numeric, gain_loss numeric)
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare v_dsa uuid;
begin
  v_dsa := nw_current_dsa_id();
  if v_dsa is null then raise exception 'Partner access required'; end if;

  if not exists (
    select 1 from nw_clients c
    where c.id = p_client_id and c.dsa_id = v_dsa and c.sourced_via = 'dsa'
  ) then
    return;
  end if;

  return query
  select h.id, 'mutual_fund'::text, coalesce(nullif(h.scheme_name, ''), h.scheme_code),
         coalesce(h.units, 0), 0::numeric,
         coalesce(h.live_value, h.rta_value, h.nav_value, 0),
         coalesce(h.live_value, h.rta_value, h.nav_value, 0),
         0::numeric
  from mf_rta_holdings h
  join mf_rta_folios f on f.id = h.folio_id
  where f.client_id = p_client_id
  order by coalesce(h.live_value, h.rta_value, h.nav_value, 0) desc;
end $function$;

-- Health guard. Appended columns only (CREATE OR REPLACE VIEW).
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
),
-- Client-held funds priced more than 3 days behind the latest full AMFI day.
-- Registrar rows: by their live price (null = could not be priced at all).
-- ISIN rows (console / CAS): by the ISIN's newest NAV, only when that NAV is
-- under 30 days old — a scheme that stopped publishing long ago (wound up,
-- segregated portfolio) is a known state, not a feed fault.
held_stale as (
  select coalesce(h.scheme_name, h.scheme_code) as name
  from mf_rta_holdings h
  where h.units > 0
    and (h.live_nav_date is null or h.live_nav_date < (select d from latest_full) - 3)
  union
  select x.name from (
    select nh.isin, nh.product_name as name from nw_holdings nh
     where nh.product_type = 'mutual_fund' and coalesce(nh.quantity, 0) > 0 and nh.isin ~ '^INF'
    union
    select cs.isin, cs.name from cas_schemes cs where cs.units > 0 and cs.isin ~ '^INF'
  ) x
  cross join lateral (select max(d.nav_date) m from nav_daily d where d.isin = x.isin) l
  where l.m < (select d from latest_full) - 3
    and l.m >= (select d from latest_full) - 30
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
  (select waiting_over_1d from tracked)                                      as tracked_waiting_over_1d,
  (select count(*) from held_stale)                                          as held_stale_navs,
  (select string_agg(name, '; ' order by name) from (select name from held_stale order by name limit 5) s) as held_stale_sample;

revoke all on public.mf_market_data_health from anon;
grant select on public.mf_market_data_health to authenticated, service_role;
