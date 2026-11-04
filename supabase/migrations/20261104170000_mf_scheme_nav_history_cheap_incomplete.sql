-- mf_scheme_nav_history: decide `complete` BEFORE reading the history.
--
-- The 2026-11-04 version aggregated a scheme's entire nav_daily history (a few
-- thousand random heap reads) and only then computed `complete`. While the
-- history backfill is unfinished almost every scheme is incomplete, and its
-- only caller (mf-returns-backfill, 300 schemes every 15 min) discards the
-- points in that case and falls back to mfapi.in — so each run read hundreds
-- of thousands of pages for nothing. On the Micro instance that kept disk IO
-- throttled after the backfill outage the same day.
--
-- Now: first/last date are two index probes on the (isin, nav_date) PK, and the
-- points (and count) are read only when the history is complete. Same keys in
-- the result; when incomplete, points = [] and count = null (never read then).
create or replace function public.mf_scheme_nav_history(p_scheme_code text)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_isin  text;
  v_first date;
  v_last  date;
  v_cur   date;
  v_complete boolean;
  v_points jsonb := '[]'::jsonb;
  v_count bigint;
begin
  select a.isin into v_isin
  from mf_asset_class a
  where a.amfi_code = p_scheme_code
    and exists (select 1 from nav_daily n where n.isin = a.isin)
  order by a.isin
  limit 1;

  if v_isin is not null then
    select min(nav_date) into v_first from nav_daily where isin = v_isin and nav > 0;
    select max(nav_date) into v_last  from nav_daily where isin = v_isin and nav > 0;
  end if;

  v_cur := public.mf_nav_history_cursor();
  v_complete := v_first is not null and v_cur is not null
                and (v_cur <= public.mf_nav_history_floor() or v_first > v_cur + 7);

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
