-- Count of transaction rows upserted by an import (CAMS WBR2/WBR2A, KFintech
-- WBTRN), alongside folios_upserted / holdings_upserted / sips_upserted.
alter table mf_rta_import_log add column if not exists txns_upserted integer;
