-- Market Watch: cached index / currency quotes + 1-day MF NAV movers.
-- -----------------------------------------------------------------------------
-- Shown in the CRM, the client portal and the partner portal. The browser never
-- calls a third-party market API: the `market-watch-refresh` edge function pulls
-- quotes server-side on a schedule and writes them here, and the pages only read
-- this cache. Every row carries the source's own timestamp (`as_of`) so each
-- figure can say how old it is.
--
-- Named market_* (not mkt_*): mkt_* is the Marketing Tool namespace.
--
-- Readable by anon as well as authenticated, like `commodity_prices` and
-- `mf_scheme_cache`: it is published market data, nothing client-scoped, and
-- the front-end demo logins have no database session.

-- 1. Index / currency quotes --------------------------------------------------
create table if not exists public.market_quotes (
  symbol      text primary key,          -- our stable key, e.g. 'NIFTY50'
  label       text not null,
  kind        text not null check (kind in ('index', 'currency')),
  sort_order  int  not null default 0,
  price       numeric,
  change      numeric,
  change_pct  numeric,
  prev_close  numeric,
  as_of       timestamptz,               -- the source's last-trade time
  source      text,                      -- 'yahoo' today; swappable later
  fetched_at  timestamptz,
  error       text                       -- last fetch error; price kept as-is
);

alter table public.market_quotes enable row level security;

drop policy if exists market_quotes_read on public.market_quotes;
create policy market_quotes_read on public.market_quotes
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.market_quotes from anon, authenticated;
grant select on public.market_quotes to anon, authenticated;

insert into public.market_quotes (symbol, label, kind, sort_order) values
  ('NIFTY50',        'NIFTY 50',          'index',    10),
  ('SENSEX',         'SENSEX',            'index',    20),
  ('BANKNIFTY',      'NIFTY Bank',        'index',    30),
  ('NIFTYMIDCAP100', 'NIFTY Midcap 100',  'index',    40),
  ('INDIAVIX',       'India VIX',         'index',    50),
  ('USDINR',         'USD / INR',         'currency', 60)
on conflict (symbol) do update
  set label = excluded.label, kind = excluded.kind, sort_order = excluded.sort_order;

-- 2. MF 1-day NAV change ------------------------------------------------------
-- One row per Regular-plan scheme in mf_scheme_cache: the latest two AMFI NAV
-- dates from nav_daily. nav_daily is authenticated-only and large, so this small
-- derived table is what the pages read (movers + watchlist funds).
create table if not exists public.market_mf_day_change (
  scheme_code    text primary key,
  scheme_name    text not null,
  fund_house     text,
  amfi_category  text,
  nav            numeric not null,
  prev_nav       numeric not null,
  change_pct     numeric not null,
  nav_date       date not null,
  prev_nav_date  date not null,
  computed_at    timestamptz not null default now()
);

create index if not exists market_mf_day_change_pct_idx
  on public.market_mf_day_change (change_pct);

alter table public.market_mf_day_change enable row level security;

drop policy if exists market_mf_day_change_read on public.market_mf_day_change;
create policy market_mf_day_change_read on public.market_mf_day_change
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.market_mf_day_change from anon, authenticated;
grant select on public.market_mf_day_change to anon, authenticated;

-- Recompute from nav_daily. The "latest" date is the latest FULL publication
-- day (>= 1000 rows): stray single rows land on later dates (a late-published
-- scheme) and would otherwise make every other fund look un-priced.
create or replace function public.market_refresh_mf_day_change()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d1 date;
  d0 date;
  n  int;
begin
  select nav_date into d1
    from nav_daily
   where nav_date > current_date - 15
   group by nav_date having count(*) >= 1000
   order by nav_date desc limit 1;
  if d1 is null then return 0; end if;

  select nav_date into d0
    from nav_daily
   where nav_date < d1 and nav_date > d1 - 15
   group by nav_date having count(*) >= 1000
   order by nav_date desc limit 1;
  if d0 is null then return 0; end if;

  -- Already computed for this pair: nothing to do (the cron runs hourly).
  if exists (select 1 from market_mf_day_change where nav_date = d1 and prev_nav_date = d0) then
    return 0;
  end if;

  delete from market_mf_day_change where true;

  insert into market_mf_day_change
    (scheme_code, scheme_name, fund_house, amfi_category, nav, prev_nav, change_pct, nav_date, prev_nav_date)
  with t as (
    select distinct on (amfi_code) amfi_code, nav
      from nav_daily where nav_date = d1 and nav > 0 and amfi_code is not null
     order by amfi_code
  ), y as (
    select distinct on (amfi_code) amfi_code, nav
      from nav_daily where nav_date = d0 and nav > 0 and amfi_code is not null
     order by amfi_code
  )
  select c.scheme_code, c.scheme_name, c.fund_house, c.amfi_category,
         t.nav, y.nav, round((t.nav / y.nav - 1) * 100, 4), d1, d0
    from mf_scheme_cache c
    join t on t.amfi_code = c.scheme_code
    join y on y.amfi_code = c.scheme_code
   where c.scheme_name !~* '\mdirect\M';

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.market_refresh_mf_day_change() from public, anon, authenticated;

-- 3. Schedules ----------------------------------------------------------------
-- Quotes: every 2 min during Indian market hours (08:30-16:30 IST, Mon-Fri)
-- and hourly otherwise (USD/INR trades longer; it also refreshes the close).
-- The function itself skips a run if the cache is under a minute old.
create or replace function public.trigger_market_watch_refresh()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/market-watch-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.trigger_market_watch_refresh() from public, anon, authenticated;

do $$ begin perform cron.unschedule('market-watch-intraday'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('market-watch-hourly');   exception when others then null; end $$;
do $$ begin perform cron.unschedule('market-mf-day-change');  exception when others then null; end $$;

select cron.schedule('market-watch-intraday', '*/2 3-10 * * 1-5', $$select trigger_market_watch_refresh()$$);
select cron.schedule('market-watch-hourly',   '7 * * * *',        $$select trigger_market_watch_refresh()$$);
-- NAVs land ~23:45 UTC (nav-refresh-daily); hourly is cheap because the
-- function returns early once the latest date pair is computed.
select cron.schedule('market-mf-day-change',  '20 * * * *',       $$select market_refresh_mf_day_change()$$);
