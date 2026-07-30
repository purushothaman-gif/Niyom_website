/*
  # Keep the BSE StAR MF module standalone

  The MF Admin console must not be coupled to CRM records: BSE onboarding,
  UCCs and orders stand on their own, and a client existing in the CRM says
  nothing about their BSE registration.

  Migration 20260731003000 had added bse_ucc / bse_ucc_status /
  bse_ucc_synced_at to nw_clients to store that link. This removes them again.
  Verified empty before dropping (0 of 55 client rows populated), so no data is
  lost. The earlier migration file was removed rather than left to re-apply.
*/

DROP INDEX IF EXISTS nw_clients_bse_ucc_key;

ALTER TABLE nw_clients DROP COLUMN IF EXISTS bse_ucc;
ALTER TABLE nw_clients DROP COLUMN IF EXISTS bse_ucc_status;
ALTER TABLE nw_clients DROP COLUMN IF EXISTS bse_ucc_synced_at;
