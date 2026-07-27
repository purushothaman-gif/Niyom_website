-- mf_detail_cache
-- ----------------
-- Server-side cache for the mf-detail edge function. Computing a fund's detail
-- means fetching its full NAV history from mfapi.in — liquid funds carry 10+
-- years of *daily* NAVs (~4,500 points, ~180KB), so a cold fetch is slow (~8s)
-- and occasionally fails transiently. Caching the computed { meta, metrics,
-- navHistory } payload keyed by scheme code makes repeat views instant and lets
-- the function fall back to a stale copy when mfapi is unreachable.
--
-- Only the service role (the edge function) reads/writes this table — the
-- browser never touches it — so no anon policy is granted.
CREATE TABLE IF NOT EXISTS mf_detail_cache (
  scheme_code    text PRIMARY KEY,
  payload        jsonb NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Staleness scans (not strictly required with a PK lookup, but cheap and useful
-- for future housekeeping / eviction jobs).
CREATE INDEX IF NOT EXISTS idx_mf_detail_cache_last_synced
  ON mf_detail_cache (last_synced_at);

ALTER TABLE mf_detail_cache ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge function) may read or write the cache.
DROP POLICY IF EXISTS "Service role can manage mf detail cache" ON mf_detail_cache;
CREATE POLICY "Service role can manage mf detail cache"
  ON mf_detail_cache FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
