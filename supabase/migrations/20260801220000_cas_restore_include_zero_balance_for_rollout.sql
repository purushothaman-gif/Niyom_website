/*
  # Restore include_zero_balance for the rollout window

  20260801210000 dropped this column in the same change that introduced
  folio_listing. The database updates instantly; the proxy on the droplet does
  not. Between the two, every client who opened the import wizard hit

      PGRST204 — Could not find the 'include_zero_balance' column
                 of 'cas_requests' in the schema cache

  because the running build still wrote it.

  Nullable, no default: the old build writes it explicitly, the new build
  ignores it, and both work. folio_listing is the source of truth either way.

  The lesson is the ordering, not the column. A schema change that removes
  something must land AFTER every deploy target has stopped using it, never
  alongside.
*/
ALTER TABLE cas_requests ADD COLUMN IF NOT EXISTS include_zero_balance boolean;

COMMENT ON COLUMN cas_requests.include_zero_balance IS
  'DEPRECATED — superseded by folio_listing. Retained only so a proxy build predating 417ab49 keeps working. Safe to drop once the droplet is on the newer build.';
