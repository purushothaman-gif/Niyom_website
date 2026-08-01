/*
  # Drop include_zero_balance — DO NOT APPLY UNTIL THE PROXY IS DEPLOYED

  The contract half of the expand/contract pair started in 20260801210000.
  folio_listing has replaced this column; nothing reads it.

  ## Before applying, confirm the droplet is on a build that no longer writes it

      curl -s https://api.niyomwealth.com/health

  The proxy must be running commit 417ab49 or later. Applying this while an
  older build is live reintroduces exactly the PGRST204 that 20260801220000
  had to repair.
*/
ALTER TABLE cas_requests DROP COLUMN IF EXISTS include_zero_balance;
