-- Restore the cheap shape of mf_scheme_nav_history (20261104170000) that
-- 20261107010000 accidentally reverted: decide `complete` FIRST, read points
-- only when complete. `complete` is now "tracked AND history loaded"
-- (mf_nav_tracked) instead of the retired global backfill cursor.
create or replace function public.mf_scheme_nav_history(p_scheme_code text)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_isin  text;
  v_first date;
  v_last  date;
  v_complete boolean := false;
  v_points jsonb := '[]'::jsonb;
  v_count bigint;
begin
  -- Prefer a tracked, loaded ISIN when the scheme code has several.
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
