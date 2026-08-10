-- AMFI's own category heading for each scheme, e.g. "Equity Scheme - Large Cap
-- Fund" or "Hybrid Scheme - Aggressive Hybrid Fund".
--
-- Stored raw, and deliberately NOT reusing mf_asset_class.asset_class. That
-- column is a TAX classification ('equity' | 'debt' | 'other') which decides a
-- fund's capital-gains rate and holding period, so an aggressive hybrid counts
-- as equity there. Research browsing asks a different question — a client
-- looking at "Hybrid" wants hybrids — and collapsing the two would either
-- mislabel funds on screen or corrupt a gains computation to suit a menu.
--
-- The heading carries both halves the UI needs (broad class before the dash,
-- sub-category after), so nothing is derived at write time and a change of mind
-- about bucketing costs a re-render rather than a re-sync.

ALTER TABLE mf_scheme_cache
  ADD COLUMN IF NOT EXISTS amfi_category text;

-- Browse-by-collection filters on the broad class, always alongside a returns
-- or name predicate, so a plain btree is what these queries can use.
CREATE INDEX IF NOT EXISTS idx_mf_scheme_cache_amfi_category
  ON mf_scheme_cache (amfi_category)
  WHERE amfi_category IS NOT NULL;
