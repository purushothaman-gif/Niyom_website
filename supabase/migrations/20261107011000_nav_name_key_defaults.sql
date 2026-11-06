-- Registrar → ISIN name matching, take 2 (2026-11-07).
--
-- 20261107010000 ADDED an implied "~regular"/"~growth" when a name omitted
-- them, but AMFI always spells them out ("Regular Plan - Growth Option") while
-- CAMS/KFintech often don't ("HDFC Flexi Cap Fund - Growth Option"), so 7 of
-- 13 registrar schemes never matched. Regular and Growth are the DEFAULTS, so
-- drop those two words from both sides; only words that distinguish a scheme
-- (direct, idcw, bonus, institutional...) remain in the key.

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
    where w <> '' and w not in ('plan', 'option', 'fund', 'scheme', 'the', 'of', 'opt', 'erstwhile',
                                'regular', 'growth')
  )
  select nullif(coalesce(string_agg(w, ' ' order by w), ''), '') from toks;
$$;

-- A stored generated column is not recomputed when its function changes.
drop index if exists public.idx_mf_asset_class_name_key;
alter table public.mf_asset_class drop column if exists name_key;
alter table public.mf_asset_class
  add column name_key text generated always as (public.mf_scheme_name_key(scheme_name)) stored;
create index idx_mf_asset_class_name_key on public.mf_asset_class (name_key);

-- Track what now matches (the sweep loads their history).
insert into public.mf_nav_tracked (isin, sources)
select distinct i, array['rta'] from mf_rta_holdings h, lateral public.mf_isins_for_scheme_name(h.scheme_name) i
on conflict (isin) do update
  set sources = case when 'rta' = any (mf_nav_tracked.sources) then mf_nav_tracked.sources
                     else mf_nav_tracked.sources || 'rta'::text end;
