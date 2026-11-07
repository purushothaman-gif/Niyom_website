-- Registrar feeds: self-documenting unknown reports + stale-snapshot guard.
--
-- 1. mf_rta_import_log.layout — when a CAMS/KFintech file arrives in a layout
--    the pipeline does not parse yet, the import logs its COLUMN NAMES (and
--    the row count) here so a parser can be written from the real file. Never
--    any record values: this table is readable by admins in the CRM.
--
-- 2. mf_rta_holdings snapshot guard — several reports now write the same
--    (registrar, folio, scheme_code) rows (CAMS WBR9 daily, full-book WBR22 /
--    WBR53, KFintech WBCUM). The unique key already prevents double rows; this
--    trigger prevents an OLDER snapshot that happens to be imported later (a
--    month-end sweep, a re-requested report) from overwriting newer units and
--    value. Equal or newer snapshots update as before.

alter table public.mf_rta_import_log
  add column if not exists layout jsonb;

comment on column public.mf_rta_import_log.layout is
  'Column names (+ row count) of a feed the pipeline did not recognise. Names only, never values.';

create or replace function public.mf_rta_holdings_keep_newest()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.snapshot_date is not null
     and new.snapshot_date is not null
     and new.snapshot_date < old.snapshot_date then
    return old; -- ignore a stale snapshot; the row keeps its newer figures
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mf_rta_holdings_keep_newest on public.mf_rta_holdings;
create trigger trg_mf_rta_holdings_keep_newest
  before update on public.mf_rta_holdings
  for each row execute function public.mf_rta_holdings_keep_newest();
