-- Give the AMFI scheme universe its own NAV and trailing returns.
--
-- mf_scheme_cache already mirrors every AMFI Direct-Growth scheme (~5,000) but
-- held only names and fund houses, so the research tools could not use it —
-- they read `mutual_funds`, a hand-curated 36 whose membership comes from a
-- hardcoded list inside update-mutual-funds.
--
-- Two feeds fill these columns, on very different budgets:
--
--   NAV      AMFI publishes every scheme's NAV in one file, already fetched
--            nightly by nav-refresh. Extending that parse costs nothing, so
--            every scheme carries a live NAV from day one.
--
--   Returns  need per-scheme history from mfapi.in — one HTTP call each, which
--            cannot run for 5,000 schemes inside one edge-function invocation.
--            A rolling job works through the universe oldest-first and then
--            keeps it fresh, so returns_synced_at doubles as the queue cursor:
--            NULL means never computed, oldest means most stale.
--
-- Anything reading these must treat a null return as "not computed yet", not
-- as "no return" — the difference matters when ranking.

ALTER TABLE mf_scheme_cache
  ADD COLUMN IF NOT EXISTS current_nav       numeric,
  ADD COLUMN IF NOT EXISTS nav_date          date,
  ADD COLUMN IF NOT EXISTS return_6m         numeric,
  ADD COLUMN IF NOT EXISTS return_1y         numeric,
  ADD COLUMN IF NOT EXISTS return_3y         numeric,
  ADD COLUMN IF NOT EXISTS return_5y         numeric,
  ADD COLUMN IF NOT EXISTS return_si         numeric,
  ADD COLUMN IF NOT EXISTS launch_date       date,
  ADD COLUMN IF NOT EXISTS returns_synced_at timestamptz,
  -- Set when mfapi has no usable history for a scheme, so the queue stops
  -- retrying it forever and the backfill keeps making progress.
  ADD COLUMN IF NOT EXISTS returns_error     text;

-- The rolling queue: never-computed first, then stalest.
CREATE INDEX IF NOT EXISTS idx_mf_scheme_cache_returns_queue
  ON mf_scheme_cache (returns_synced_at NULLS FIRST)
  WHERE returns_error IS NULL;

-- Ranking surfaces (Top performers, collections) only ever consider schemes
-- whose returns exist, so the partial index matches the query.
CREATE INDEX IF NOT EXISTS idx_mf_scheme_cache_r3y
  ON mf_scheme_cache (return_3y DESC NULLS LAST)
  WHERE return_3y IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mf_scheme_cache_r1y
  ON mf_scheme_cache (return_1y DESC NULLS LAST)
  WHERE return_1y IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mf_scheme_cache_house
  ON mf_scheme_cache (fund_house);

-- Free-text search across the ~5,000 names, which is now a server-side query
-- rather than an in-memory filter over 36 rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_mf_scheme_cache_search
  ON mf_scheme_cache USING gin (search_name gin_trgm_ops);
