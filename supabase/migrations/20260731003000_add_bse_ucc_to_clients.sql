/*
  # Link CRM clients to their BSE StAR MF UCC

  The MF Admin console had to match nw_clients to BSE UCCs by PAN, because no
  link was stored. That is fragile: a client whose PAN is blank in the CRM, or
  differs from the one registered at BSE, silently reads as "not registered" —
  and two clients sharing a PAN (a data-entry error) would collide.

  This stores the link explicitly. `bse_ucc` is the client code BSE assigned;
  the cached status/synced_at let the console show onboarding state without
  calling BSE for every row, while BSE stays the source of truth.

  Additive and nullable — existing rows are untouched and the PAN fallback in
  ClientBridgeService keeps working for clients registered before this landed.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nw_clients' AND column_name = 'bse_ucc'
  ) THEN
    ALTER TABLE nw_clients ADD COLUMN bse_ucc text;
    COMMENT ON COLUMN nw_clients.bse_ucc IS
      'BSE StAR MF client code (UCC) assigned to this client. NULL until registered.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nw_clients' AND column_name = 'bse_ucc_status'
  ) THEN
    ALTER TABLE nw_clients ADD COLUMN bse_ucc_status text;
    COMMENT ON COLUMN nw_clients.bse_ucc_status IS
      'Last known BSE UCC status (PENDING_AUTH / PENDING_VERIFICATION / ACTIVE ...). Cache only — BSE is authoritative.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nw_clients' AND column_name = 'bse_ucc_synced_at'
  ) THEN
    ALTER TABLE nw_clients ADD COLUMN bse_ucc_synced_at timestamptz;
    COMMENT ON COLUMN nw_clients.bse_ucc_synced_at IS
      'When bse_ucc_status was last refreshed from BSE.';
  END IF;
END $$;

-- One UCC belongs to exactly one client. Partial, so the many NULLs do not clash.
CREATE UNIQUE INDEX IF NOT EXISTS nw_clients_bse_ucc_key
  ON nw_clients (bse_ucc)
  WHERE bse_ucc IS NOT NULL;
