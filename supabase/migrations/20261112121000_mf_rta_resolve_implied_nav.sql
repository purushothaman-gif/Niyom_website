-- Follow-up to 20261112120000_mf_rta_live_nav: ISIN resolution for registrar
-- rows that carry no NAV (CAMS rows often send only RUPEE_BAL).
--
-- ICICI Prudential Small Cap Fund - Growth name-matches two Regular-Growth
-- ISINs (one is a dead legacy share class). With no registrar NAV the resolver
-- required a unique candidate and gave up. Now:
--   * a candidate counts only if it has a NAV within 15 days of the snapshot
--     (dead share classes drop out), and
--   * the registrar's implied NAV (value / units) stands in for a missing NAV.

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
               and d.nav_date >  coalesce(p_date, current_date) - 15
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

-- The registrar's NAV, or what its valuation implies per unit.
create or replace function public.mf_rta_implied_nav(p_nav numeric, p_rta_value numeric, p_nav_value numeric, p_units numeric)
returns numeric
language sql immutable
as $$
  select case
    when p_nav > 0 then p_nav
    when p_units > 0 and coalesce(p_rta_value, p_nav_value) > 0 then coalesce(p_rta_value, p_nav_value) / p_units
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
      new.isin := public.mf_rta_resolve_isin(
        new.scheme_name,
        public.mf_rta_implied_nav(new.nav, new.rta_value, new.nav_value, new.units),
        new.snapshot_date);
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

create or replace function public.mf_rta_reprice()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  -- Touching a row fires trg_mf_rta_holdings_zz_live_nav, which (re)resolves
  -- the ISIN when missing and recomputes the live price.
  update mf_rta_holdings h
     set isin = h.isin
   where h.units > 0
     and (h.isin is null
          or h.live_nav_date is null
          or h.live_nav_date < (select max(d.nav_date) from nav_daily d where d.isin = h.isin));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mf_rta_reprice() from public, anon, authenticated;
