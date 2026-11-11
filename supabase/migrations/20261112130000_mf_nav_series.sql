-- mf_nav_series — every published NAV of a scheme, as ONE compact row.
-- =============================================================================
-- Why this exists
--
-- Returns, the fund-page chart and the SIP / lumpsum tools all need a scheme's
-- whole NAV history. That used to come from mfapi.in, a free third-party mirror
-- of AMFI, called live. This table lets the same history come from AMFI itself.
--
-- AMFI's per-scheme history feed (www.amfiindia.com/api/nav-history) is far too
-- slow to call while a client waits — a 5-year window takes 20–60 seconds — so
-- history is loaded in the background by the `mf-nav-series` edge function and
-- kept here. Once a scheme is loaded it is kept current from nav_daily, which
-- the nightly AMFI file already fills, so AMFI's history feed is only ever
-- asked for a scheme's past once.
--
-- Why arrays and not nav_daily rows
--
-- nav_daily stores one row per NAV (~180 bytes with its index). The 2,000 or so
-- live schemes would be ~1.1 GB that way; this database is ~310 MB in total and
-- has already had one disk-full incident. Two parallel arrays cost ~12 bytes a
-- point: roughly 30 KB a scheme, ~60 MB for the lot.
--
--   d  days since 1970-01-01, ascending, one entry per NAV date
--   n  the NAV on that day
--
-- nav_daily is unchanged and still the store for funds clients HOLD (the gains
-- engine joins on it by ISIN). This table is keyed by AMFI scheme code and
-- serves research and tools.
--
-- status
--   pending  history still being loaded; cursor_to is the end date of the next
--            window to fetch (the loader walks BACKWARDS from today)
--   loaded   whole history in hand, kept current nightly
--   tail     loaded, but fell more than nav_daily's retention behind — the
--            loader re-fetches just the missing recent stretch from AMFI
--   empty    AMFI has no NAV for this code at all

create table if not exists public.mf_nav_series (
  amfi_code       text primary key,
  d               integer[]          not null default '{}',
  n               double precision[] not null default '{}',
  first_date      date,
  last_date       date,
  status          text not null default 'pending'
                    check (status in ('pending', 'loaded', 'tail', 'empty')),
  cursor_to       date,
  -- 0 = someone is looking at this fund right now, 1 = curated / recommended,
  -- 2 = a client holds it, 5 = the rest of the live universe.
  priority        smallint not null default 5,
  attempts        integer  not null default 0,
  last_attempt_at timestamptz,
  last_error      text,
  loaded_at       timestamptz,
  appended_at     timestamptz,
  requested_at    timestamptz not null default now(),
  constraint mf_nav_series_parallel check (cardinality(d) = cardinality(n))
);

comment on table public.mf_nav_series is
  'Full NAV history per AMFI scheme code as parallel arrays (d = days since epoch, n = NAV). Loaded from AMFI by the mf-nav-series function, appended nightly from nav_daily.';

create index if not exists idx_mf_nav_series_queue
  on public.mf_nav_series (priority, requested_at)
  where status in ('pending', 'tail');

-- Service role only: read through edge functions and SECURITY DEFINER functions.
alter table public.mf_nav_series enable row level security;
revoke all on public.mf_nav_series from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

create or replace function public.mf_nav_series_enqueue(p_codes text[], p_priority integer default 5)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  if p_codes is null or cardinality(p_codes) = 0 then return 0; end if;
  with ins as (
    insert into mf_nav_series (amfi_code, priority)
    select distinct c, p_priority::smallint
    from unnest(p_codes) c
    where c ~ '^[0-9]{1,9}$'
    on conflict (amfi_code) do update
      set priority = least(mf_nav_series.priority, excluded.priority),
          -- a scheme that was given up on gets another go when asked for again
          attempts = case when excluded.priority < mf_nav_series.priority then 0 else mf_nav_series.attempts end
      where mf_nav_series.status in ('pending', 'tail')
        and excluded.priority < mf_nav_series.priority
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$$;

-- Everything the site can show a history for: curated funds and staff picks
-- first, then funds clients hold, then the rest of the live universe.
create or replace function public.mf_nav_series_seed()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer := 0;
begin
  v_n := v_n + mf_nav_series_enqueue(
    (select array_agg(distinct fund_code) from mutual_funds where fund_code ~ '^[0-9]+$'), 1);
  v_n := v_n + mf_nav_series_enqueue(
    (select array_agg(distinct amfi_code) from nw_mf_recommendations where amfi_code ~ '^[0-9]+$'), 1);
  v_n := v_n + mf_nav_series_enqueue(
    (select array_agg(distinct a.amfi_code)
       from mf_nav_tracked t join mf_asset_class a on a.isin = t.isin
      where a.amfi_code ~ '^[0-9]+$'), 2);
  v_n := v_n + mf_nav_series_enqueue(
    (select array_agg(scheme_code) from mf_scheme_cache
      where scheme_code ~ '^[0-9]+$' and current_nav is not null and nav_date >= current_date - 15), 5);
  return v_n;
end;
$$;

-- Hand out work. A row in flight carries a recent last_attempt_at; `p_force`
-- lets one invocation keep claiming across its own rounds, while a second
-- invocation that overlaps it finds the loader busy and claims nothing — AMFI
-- rate-limits at about three simultaneous requests.
create or replace function public.mf_nav_series_claim(
  p_limit integer default 2,
  p_max_priority integer default 9,
  p_force boolean default false
)
returns table (amfi_code text, status text, cursor_to date, last_date date, points integer)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not p_force and exists (
    select 1 from mf_nav_series s
    where s.status in ('pending', 'tail') and s.attempts > 0
      and s.last_attempt_at > now() - interval '100 seconds'
  ) then
    return;
  end if;

  return query
  update mf_nav_series s
     set attempts = s.attempts + 1, last_attempt_at = now()
    from (
      select q.amfi_code
        from mf_nav_series q
       where q.status in ('pending', 'tail')
         and q.attempts < 8
         and q.priority <= p_max_priority
         and (q.last_attempt_at is null
              or q.last_attempt_at < now() - make_interval(mins => least(5 * q.attempts, 120)))
       order by q.priority, q.requested_at
       limit greatest(p_limit, 0)
       for update skip locked
    ) c
   where s.amfi_code = c.amfi_code
  returning s.amfi_code, s.status, s.cursor_to, s.last_date, cardinality(s.d);
end;
$$;

-- Fold one fetched window into a scheme. Dates already present keep the value
-- they have; the result stays sorted and one-per-day.
create or replace function public.mf_nav_series_merge(
  p_code text,
  p_d integer[],
  p_n double precision[],
  p_cursor_to date,
  p_done boolean
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_d integer[];
  v_n double precision[];
begin
  if coalesce(cardinality(p_d), 0) <> coalesce(cardinality(p_n), 0) then
    raise exception 'mf_nav_series_merge: d and n differ in length';
  end if;

  select coalesce(array_agg(m.d order by m.d), '{}'), coalesce(array_agg(m.n order by m.d), '{}')
    into v_d, v_n
  from (
    select distinct on (u.d) u.d, u.n
    from (
      select x.d, x.n, 0 as src
        from mf_nav_series s, unnest(s.d, s.n) as x(d, n)
       where s.amfi_code = p_code
      union all
      select y.d, y.n, 1
        from unnest(coalesce(p_d, '{}'), coalesce(p_n, '{}')) as y(d, n)
       where y.n > 0
    ) u
    order by u.d, u.src
  ) m;

  update mf_nav_series s
     set d = v_d,
         n = v_n,
         first_date = case when cardinality(v_d) > 0 then date '1970-01-01' + v_d[1] end,
         last_date  = case when cardinality(v_d) > 0 then date '1970-01-01' + v_d[cardinality(v_d)] end,
         cursor_to = case when p_done then null else p_cursor_to end,
         status = case when not p_done then s.status
                       when cardinality(v_d) > 0 then 'loaded'
                       else 'empty' end,
         loaded_at = case when p_done then now() else s.loaded_at end,
         attempts = 0,
         last_attempt_at = null,
         last_error = null
   where s.amfi_code = p_code;

  return cardinality(v_d);
end;
$$;

create or replace function public.mf_nav_series_fail(p_code text, p_error text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update mf_nav_series set last_error = left(p_error, 300) where amfi_code = p_code;
$$;

-- ---------------------------------------------------------------------------
-- Staying current: append the days nav_daily has that the series does not.
-- nav_daily keeps ~10 days for every scheme (nav-prune), filled each night from
-- AMFI's daily file, so a loaded series never needs AMFI's history feed again
-- unless it somehow falls further behind than that — then it is marked `tail`.
-- ---------------------------------------------------------------------------

create or replace function public.mf_nav_series_append()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_floor date;
  v_n integer;
begin
  -- The oldest day nav_daily still holds for the universe at large.
  select min(nav_date) into v_floor
    from (select nav_date from nav_daily
           where nav_date > current_date - 9
           group by nav_date having count(*) > 1000) x;
  if v_floor is null then return 0; end if;

  with recent as (
    select amfi_code, nav_date, max(nav) as nav
      from nav_daily
     where nav_date >= v_floor and amfi_code is not null and nav > 0
     group by amfi_code, nav_date
  ),
  fresh as (
    select s.amfi_code,
           array_agg((r.nav_date - date '1970-01-01') order by r.nav_date) as d,
           array_agg(r.nav::double precision order by r.nav_date) as n,
           max(r.nav_date) as last_date
      from mf_nav_series s
      join recent r on r.amfi_code = s.amfi_code and r.nav_date > s.last_date
     where s.status = 'loaded'
       and s.last_date >= v_floor - 1      -- contiguous with what nav_daily holds
     group by s.amfi_code
  ),
  upd as (
    update mf_nav_series s
       set d = s.d || f.d, n = s.n || f.n, last_date = f.last_date, appended_at = now()
      from fresh f
     where s.amfi_code = f.amfi_code
    returning 1
  )
  select count(*) into v_n from upd;

  -- Fell behind the retained window while newer NAVs exist: fetch the gap.
  update mf_nav_series s
     set status = 'tail', attempts = 0, last_attempt_at = null, requested_at = now()
   where s.status = 'loaded'
     and s.last_date < v_floor - 1
     and exists (select 1 from nav_daily r
                  where r.nav_date >= v_floor and r.amfi_code = s.amfi_code);

  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

create or replace function public.trigger_mf_market_data(p_function text, p_body jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_secret text;
begin
  if p_function not in ('nav-backfill', 'mf-market-data', 'mf-nav-series') then
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

-- Runs every minute and does nothing unless there is work. Funds someone is
-- waiting on (priority <= 2) load at any hour; the bulk of the universe loads
-- only outside Indian business hours (09:30–18:30 IST = 04–12 UTC), as a
-- courtesy to AMFI's site. Our own database load is one small row per window.
create or replace function public.mf_nav_series_tick()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_urgent integer;
  v_pending integer;
  v_hour integer := extract(hour from now() at time zone 'utc');
  v_max integer := 9;
begin
  select count(*) filter (where priority <= 2), count(*)
    into v_urgent, v_pending
    from mf_nav_series
   where status in ('pending', 'tail') and attempts < 8;

  if v_pending = 0 then return 0; end if;
  if v_hour between 4 and 12 then
    if v_urgent = 0 then return 0; end if;
    v_max := 2;
  end if;

  perform public.trigger_mf_market_data('mf-nav-series',
    jsonb_build_object('action', 'load', 'max_priority', v_max));
  return v_pending;
end;
$$;

revoke all on function public.mf_nav_series_enqueue(text[], integer) from public, anon, authenticated;
revoke all on function public.mf_nav_series_seed() from public, anon, authenticated;
revoke all on function public.mf_nav_series_claim(integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.mf_nav_series_merge(text, integer[], double precision[], date, boolean) from public, anon, authenticated;
revoke all on function public.mf_nav_series_fail(text, text) from public, anon, authenticated;
revoke all on function public.mf_nav_series_append() from public, anon, authenticated;
revoke all on function public.mf_nav_series_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Readers: the returns job already asks this function for local history before
-- it goes anywhere else, so teaching it about the series moves returns onto
-- AMFI data for every loaded scheme with no change to the job.
-- ---------------------------------------------------------------------------

create or replace function public.mf_scheme_nav_history(p_scheme_code text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_isin  text;
  v_first date;
  v_last  date;
  v_complete boolean := false;
  v_points jsonb := '[]'::jsonb;
  v_count bigint;
  v_series mf_nav_series%rowtype;
begin
  -- The compact AMFI series first: one row, the whole history.
  -- (A caller without rights on that table simply falls through to nav_daily.)
  begin
    select * into v_series from mf_nav_series
     where amfi_code = p_scheme_code and status in ('loaded', 'tail') and cardinality(d) > 0;
  exception when insufficient_privilege then
    v_series := null;
  end;
  if v_series.amfi_code is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'date', to_char(date '1970-01-01' + x.d, 'DD-MM-YYYY'), 'nav', x.n::text)
             order by x.d desc), '[]'::jsonb)
      into v_points
      from unnest(v_series.d, v_series.n) as x(d, n);
    return jsonb_build_object(
      'isin', null,
      'first_date', v_series.first_date,
      'last_date', v_series.last_date,
      'count', cardinality(v_series.d),
      'complete', true,
      'source', 'amfi_series',
      'points', v_points
    );
  end if;

  select a.isin, coalesce(t.history_loaded_at is not null, false)
    into v_isin, v_complete
  from mf_asset_class a
  left join mf_nav_tracked t on t.isin = a.isin
  where a.amfi_code = p_scheme_code
    and exists (select 1 from nav_daily n where n.isin = a.isin)
  order by (t.history_loaded_at is not null) desc, a.isin
  limit 1;

  if v_isin is not null then
    select min(nav_date) into v_first from nav_daily where isin = v_isin and nav > 0;
    select max(nav_date) into v_last  from nav_daily where isin = v_isin and nav > 0;
  end if;

  v_complete := coalesce(v_complete, false) and v_first is not null;

  if v_complete then
    select count(*),
           coalesce(jsonb_agg(jsonb_build_object('date', to_char(nav_date, 'DD-MM-YYYY'), 'nav', nav::text)
                              order by nav_date desc), '[]'::jsonb)
      into v_count, v_points
    from nav_daily
    where isin = v_isin and nav > 0;
  end if;

  return jsonb_build_object(
    'isin', v_isin,
    'first_date', v_first,
    'last_date', v_last,
    'count', v_count,
    'complete', v_complete,
    'points', v_points
  );
end;
$$;

-- Schedules are created by the follow-up migration once the loader is deployed.
