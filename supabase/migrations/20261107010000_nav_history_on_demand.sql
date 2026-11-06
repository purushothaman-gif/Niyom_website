-- =============================================================================
-- NAV history ON DEMAND — only for funds someone actually holds (2026-11-07)
--
-- Phase 1 (20261104130000) back-filled the FULL AMFI universe into nav_daily:
-- 29M rows / 4.5 GB, 96% of the database, for ~17k schemes nobody here owns —
-- and its every-minute backfill took the site down on 2026-11-04.
--
-- New rule: nav_daily keeps
--   * full history for TRACKED ISINs (mf_nav_tracked) — every fund that appears
--     in a CAS upload, the registrar (Niyom ARN) feed, a CRM holding, a
--     transaction, a deal line or a recommendation;
--   * the last NAV_KEEP_DAYS days for every other scheme — the daily AMFI file
--     still lands in full, because SchemePicker uses nav_daily as its catalogue
--     and mf_nav_validate compares day over day;
--   * 31-Jan-2018 for every scheme (grandfathering, s.55(2)(ac)) — 17k rows.
--
-- A fund appearing ANYWHERE for the first time is tracked by trigger and its
-- full history is fetched straight away (pg_net → nav-backfill mode 'scheme',
-- from mfapi.in by AMFI code). A 10-minute sweep retries anything that failed.
--
-- Returns: mf_scheme_nav_history now says `complete` only for a tracked ISIN
-- whose history has loaded. Everything else falls back to mfapi.in exactly as
-- mf-returns-backfill did before Phase 1 — nothing regresses.
-- =============================================================================

-- 1. Tracked ISINs -------------------------------------------------------------
create table if not exists public.mf_nav_tracked (
  isin               text primary key check (isin ~ '^INF[A-Z0-9]{9}$'),
  sources            text[] not null default '{}',
  first_seen_at      timestamptz not null default now(),
  history_loaded_at  timestamptz,
  history_first_date date,
  history_rows       integer,
  attempts           integer not null default 0,
  last_attempt_at    timestamptz,
  last_error         text
);
comment on table public.mf_nav_tracked is
  'ISINs whose FULL NAV history nav_daily keeps. Filled by triggers on every table a fund can enter through; history fetched on demand by nav-backfill (mode scheme).';

alter table public.mf_nav_tracked enable row level security;
drop policy if exists mf_nav_tracked_read on public.mf_nav_tracked;
create policy mf_nav_tracked_read on public.mf_nav_tracked
  for select to authenticated using (true);  -- market data, no client identity
revoke all on public.mf_nav_tracked from anon;
grant select on public.mf_nav_tracked to authenticated;

create index if not exists idx_mf_nav_tracked_pending
  on public.mf_nav_tracked (last_attempt_at nulls first) where history_loaded_at is null;

-- 2. Registrar scheme names → ISIN --------------------------------------------
-- CAMS/KFintech feeds carry the registrar's own product code, not an ISIN, and
-- word the name differently from AMFI ("Gr. REGULAR" vs "Regular Plan -
-- Growth"). Compare a normalised, ORDER-FREE token set instead. Ambiguity
-- resolves to every match — extra history is cheap, missing history is not.
create or replace function public.mf_scheme_name_key(p_name text)
returns text
language sql immutable parallel safe
set search_path = public
as $$
  with t as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(p_name, '')), '&', ' and ', 'g'),
             '\mgr\M\.?', ' growth ', 'g'),
           '[^a-z0-9]+', ' ', 'g') as s
  ),
  toks as (
    select distinct w
    from t, regexp_split_to_table(t.s, ' ') w
    where w <> '' and w not in ('plan', 'option', 'fund', 'scheme', 'the', 'of', 'opt', 'erstwhile')
  ),
  base as (select coalesce(string_agg(w, ' ' order by w), '') k from toks)
  select case when k = '' then null else
           k
           || case when k !~ '\m(direct|regular)\M' then ' ~regular' else '' end
           || case when k !~ '\m(growth|idcw|dividend|bonus|payout|reinvestment)\M' then ' ~growth' else '' end
         end
  from base;
$$;

alter table public.mf_asset_class
  add column if not exists name_key text generated always as (public.mf_scheme_name_key(scheme_name)) stored;
create index if not exists idx_mf_asset_class_name_key on public.mf_asset_class (name_key);

create or replace function public.mf_isins_for_scheme_name(p_name text)
returns setof text
language sql stable
set search_path = public
as $$
  select a.isin from mf_asset_class a
  where a.name_key = public.mf_scheme_name_key(p_name)
    and a.isin ~ '^INF[A-Z0-9]{9}$';
$$;

-- 3. Ask nav-backfill to load history (async, pg_net) --------------------------
create or replace function public.mf_nav_request_history(p_isins text[])
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_isins is null or cardinality(p_isins) = 0 then return; end if;
  update mf_nav_tracked set last_attempt_at = now() where isin = any (p_isins);
  perform public.trigger_mf_market_data('nav-backfill',
    jsonb_build_object('mode', 'scheme', 'isins', to_jsonb(p_isins)));
end;
$$;

-- 4. Track an ISIN (idempotent). Fires the history fetch only when NEW. --------
create or replace function public.mf_nav_track(p_isin text, p_source text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_isin text := upper(trim(coalesce(p_isin, '')));
  v_new  boolean;
begin
  if v_isin !~ '^INF[A-Z0-9]{9}$' then return; end if;
  insert into mf_nav_tracked as t (isin, sources)
  values (v_isin, array[p_source])
  on conflict (isin) do update
    set sources = case when p_source = any (t.sources) then t.sources else t.sources || p_source end
  returning (xmax = 0) into v_new;
  if v_new then
    perform public.mf_nav_request_history(array[v_isin]);
  end if;
end;
$$;

-- 5. Triggers on every table a fund can enter through --------------------------
-- A tracking failure must NEVER block the business write (a CAS import, a
-- deal), so every trigger swallows its own errors.
create or replace function public.mf_nav_track_trg()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_isin text;
begin
  begin
    if tg_table_name = 'mf_rta_holdings' then
      for v_isin in select public.mf_isins_for_scheme_name(new.scheme_name) loop
        perform public.mf_nav_track(v_isin, 'rta');
      end loop;
    elsif tg_table_name = 'nw_mf_recommendations' then
      for v_isin in select a.isin from mf_asset_class a where a.amfi_code = new.amfi_code loop
        perform public.mf_nav_track(v_isin, 'recommendation');
      end loop;
    else
      perform public.mf_nav_track(new.isin, tg_table_name);
    end if;
  exception when others then
    raise warning 'mf_nav_track_trg(%): %', tg_table_name, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_mf_nav_track on public.cas_schemes;
create trigger trg_mf_nav_track after insert or update of isin on public.cas_schemes
  for each row when (new.isin like 'INF%') execute function public.mf_nav_track_trg();

drop trigger if exists trg_mf_nav_track on public.nw_holdings;
create trigger trg_mf_nav_track after insert or update of isin on public.nw_holdings
  for each row when (new.isin like 'INF%') execute function public.mf_nav_track_trg();

drop trigger if exists trg_mf_nav_track on public.nw_transactions;
create trigger trg_mf_nav_track after insert or update of isin on public.nw_transactions
  for each row when (new.isin like 'INF%') execute function public.mf_nav_track_trg();

drop trigger if exists trg_mf_nav_track on public.nw_deal_confirmation_items;
create trigger trg_mf_nav_track after insert or update of isin on public.nw_deal_confirmation_items
  for each row when (new.isin like 'INF%') execute function public.mf_nav_track_trg();

drop trigger if exists trg_mf_nav_track on public.mf_rta_holdings;
create trigger trg_mf_nav_track after insert or update of scheme_name on public.mf_rta_holdings
  for each row execute function public.mf_nav_track_trg();

drop trigger if exists trg_mf_nav_track on public.nw_mf_recommendations;
create trigger trg_mf_nav_track after insert or update of amfi_code on public.nw_mf_recommendations
  for each row execute function public.mf_nav_track_trg();

-- 6. nav-backfill reports back -------------------------------------------------
create or replace function public.mf_nav_tracked_result(
  p_isin text, p_ok boolean, p_first_date date, p_rows integer, p_error text)
returns void
language sql security definer
set search_path = public
as $$
  update mf_nav_tracked set
    history_loaded_at  = case when p_ok then now() else history_loaded_at end,
    history_first_date = case when p_ok then p_first_date else history_first_date end,
    history_rows       = case when p_ok then p_rows else history_rows end,
    attempts           = attempts + 1,
    last_attempt_at    = now(),
    last_error         = case when p_ok then null else left(p_error, 500) end
  where isin = p_isin;
$$;

-- 7. Sweep: retry failures with back-off, at most 10 ISINs per call ------------
create or replace function public.mf_nav_history_sweep()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_isins text[];
begin
  select array_agg(isin) into v_isins from (
    select isin from mf_nav_tracked
    where history_loaded_at is null
      and attempts < 6
      and (last_attempt_at is null or last_attempt_at < now() - make_interval(mins => 15 * greatest(attempts, 1)))
    order by last_attempt_at nulls first
    limit 10
  ) s;
  perform public.mf_nav_request_history(v_isins);
  return coalesce(cardinality(v_isins), 0);
end;
$$;

-- 8. Prune: drop old rows of untracked schemes (daily) -------------------------
create or replace function public.mf_nav_keep_days()
returns integer language sql immutable as $$ select 10 $$;

create or replace function public.mf_nav_prune(p_limit integer default 200000)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with doomed as (
    select n.isin, n.nav_date
    from nav_daily n
    where n.nav_date < current_date - public.mf_nav_keep_days()
      and n.nav_date <> date '2018-01-31'
      and not exists (select 1 from mf_nav_tracked t where t.isin = n.isin)
    limit p_limit
  )
  delete from nav_daily d using doomed
  where d.isin = doomed.isin and d.nav_date = doomed.nav_date;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 9. `complete` now means "tracked and loaded", not "global cursor passed it" --
create or replace function public.mf_scheme_nav_history(p_scheme_code text)
returns jsonb
language sql stable
set search_path = public
as $$
  with isin as (
    select a.isin, (t.history_loaded_at is not null) as loaded
    from mf_asset_class a
    left join mf_nav_tracked t on t.isin = a.isin
    where a.amfi_code = p_scheme_code
      and exists (select 1 from nav_daily n where n.isin = a.isin)
    order by (t.history_loaded_at is not null) desc, a.isin
    limit 1
  ),
  pts as (
    select n.nav_date, n.nav
    from nav_daily n
    where n.isin = (select isin from isin) and n.nav > 0
  ),
  bounds as (select min(nav_date) as first_date, max(nav_date) as last_date, count(*) as n from pts)
  select jsonb_build_object(
    'isin', (select isin from isin),
    'first_date', b.first_date,
    'last_date', b.last_date,
    'count', b.n,
    'complete', coalesce((select loaded from isin), false),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(nav_date, 'DD-MM-YYYY'), 'nav', nav::text)
                       order by nav_date desc)
      from pts), '[]'::jsonb)
  )
  from bounds b;
$$;

-- 10. Lock-down ----------------------------------------------------------------
revoke all on function public.mf_scheme_name_key(text)          from public, anon;
revoke all on function public.mf_isins_for_scheme_name(text)    from public, anon;
revoke all on function public.mf_nav_request_history(text[])    from public, anon, authenticated;
revoke all on function public.mf_nav_track(text, text)          from public, anon, authenticated;
revoke all on function public.mf_nav_track_trg()                from public, anon, authenticated;
revoke all on function public.mf_nav_tracked_result(text, boolean, date, integer, text) from public, anon, authenticated;
revoke all on function public.mf_nav_history_sweep()            from public, anon, authenticated;
revoke all on function public.mf_nav_prune(integer)             from public, anon, authenticated;
grant execute on function public.mf_scheme_name_key(text)       to authenticated, service_role;
grant execute on function public.mf_isins_for_scheme_name(text) to authenticated, service_role;
grant execute on function public.mf_nav_tracked_result(text, boolean, date, integer, text) to service_role;
grant execute on function public.mf_nav_history_sweep()         to service_role;
grant execute on function public.mf_nav_prune(integer)          to service_role;

-- 11. Seed from what is held today (no HTTP here — the sweep loads them) -------
insert into public.mf_nav_tracked (isin, sources)
select isin, array_agg(distinct src)
from (
  select upper(isin) isin, 'cas_schemes' src from cas_schemes where isin ~ '^INF[A-Z0-9]{9}$'
  union all select upper(isin), 'nw_holdings' from nw_holdings where isin ~ '^INF[A-Z0-9]{9}$'
  union all select upper(isin), 'nw_transactions' from nw_transactions where isin ~ '^INF[A-Z0-9]{9}$'
  union all select upper(isin), 'nw_deal_confirmation_items' from nw_deal_confirmation_items where isin ~ '^INF[A-Z0-9]{9}$'
  union all select i, 'rta' from mf_rta_holdings h, lateral public.mf_isins_for_scheme_name(h.scheme_name) i
  union all select a.isin, 'recommendation' from nw_mf_recommendations r join mf_asset_class a on a.amfi_code = r.amfi_code
) s
where isin ~ '^INF[A-Z0-9]{9}$'
group by isin
on conflict (isin) do nothing;

-- 12. Schedules: stop the universe backfill; add sweep + prune -----------------
do $$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname in ('nav-history-backfill', 'nav-history-sweep', 'nav-prune') loop
    perform cron.unschedule(v_job);
  end loop;
end $$;
select cron.schedule('nav-history-sweep', '*/10 * * * *', 'select public.mf_nav_history_sweep()');
-- 00:30 IST, after the 23:45 UTC daily refresh has long finished.
select cron.schedule('nav-prune', '0 19 * * *', 'select public.mf_nav_prune(500000)');
