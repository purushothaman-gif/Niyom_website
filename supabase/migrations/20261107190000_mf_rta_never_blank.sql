-- Registrar feeds: a sparse report must never blank what a richer one filled.
--
-- Several reports now write the same folio and holding rows:
--   folios    CAMS WBR9 (full static), WBR53 (PAN/ARN only), WBR22 (name/tax
--             status only), KFintech WBMST (full master), WBCUM (partial)
--   holdings  CAMS WBR9 / WBR53 / WBR22, KFintech WBCUM
-- The upserts send every column, so a report that lacks a field sends NULL (or
-- an empty array) for it. These BEFORE UPDATE triggers keep the stored value in
-- that case. Rows are still keyed by their unique constraints — one folio, one
-- holding per scheme — so nothing is ever entered twice.

create or replace function public.mf_rta_folios_keep_known()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.amc_code        := coalesce(new.amc_code, old.amc_code);
  new.holder_name     := coalesce(new.holder_name, old.holder_name);
  new.pan             := coalesce(new.pan, old.pan);
  new.tax_status      := coalesce(new.tax_status, old.tax_status);
  new.arn             := coalesce(new.arn, old.arn);
  new.sub_broker      := coalesce(new.sub_broker, old.sub_broker);
  new.email           := coalesce(new.email, old.email);
  new.mobile          := coalesce(new.mobile, old.mobile);
  new.demat           := coalesce(new.demat, old.demat);
  new.folio_open_date := coalesce(new.folio_open_date, old.folio_open_date);
  if coalesce(cardinality(new.joint_names), 0) = 0 then new.joint_names := old.joint_names; end if;
  if coalesce(cardinality(new.joint_pans), 0) = 0 then new.joint_pans := old.joint_pans; end if;
  -- client_id / matched_at / first_seen_at are not sent by the import upserts;
  -- an explicit match update sets them and is respected as-is.
  return new;
end;
$$;

drop trigger if exists trg_mf_rta_folios_keep_known on public.mf_rta_folios;
create trigger trg_mf_rta_folios_keep_known
  before update on public.mf_rta_folios
  for each row execute function public.mf_rta_folios_keep_known();

-- Holdings: keep the newest snapshot (unchanged rule) and never blank labels.
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
  new.scheme_name := coalesce(new.scheme_name, old.scheme_name);
  new.amc_code    := coalesce(new.amc_code, old.amc_code);
  -- NAV is only meaningful for the snapshot it came with: keep the old one only
  -- when this update is for the same date.
  if new.nav is null and new.snapshot_date is not distinct from old.snapshot_date then
    new.nav := old.nav;
    new.nav_value := coalesce(new.nav_value, old.nav_value);
  end if;
  return new;
end;
$$;
