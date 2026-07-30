/*
  # Link a client to their BSE UCC — authorization anchor

  Re-adds what 20260731010000 dropped, now for a security reason rather than
  convenience. Clients are to buy and sell in their own name, so the proxy must
  be able to answer "which UCC does this caller own?" and refuse everything
  else. Without a stored link there is no way to scope a client request, and a
  client could pass any UCC in the body and transact on someone else's account.

  BSE remains the source of truth for UCC state; status/synced_at are cache.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='nw_clients' AND column_name='bse_ucc') THEN
    ALTER TABLE nw_clients ADD COLUMN bse_ucc text;
    COMMENT ON COLUMN nw_clients.bse_ucc IS
      'BSE StAR MF client code (UCC). Authorization anchor: the proxy scopes a client to this and ignores any UCC in the request body.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='nw_clients' AND column_name='bse_ucc_status') THEN
    ALTER TABLE nw_clients ADD COLUMN bse_ucc_status text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='nw_clients' AND column_name='bse_ucc_synced_at') THEN
    ALTER TABLE nw_clients ADD COLUMN bse_ucc_synced_at timestamptz;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS nw_clients_bse_ucc_key
  ON nw_clients (bse_ucc) WHERE bse_ucc IS NOT NULL;

CREATE INDEX IF NOT EXISTS nw_clients_client_auth_user_id_idx
  ON nw_clients (client_auth_user_id) WHERE client_auth_user_id IS NOT NULL;
