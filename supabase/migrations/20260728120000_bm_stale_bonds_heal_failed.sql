/*
  # Self-heal bonds whose analytics failed but whose data is now present

  bm_stale_bonds (the recompute selector used by the yield cron) only flagged bonds whose
  PRICE was newer than their analytics. But a bond's master fields (e.g. maturity) can be
  populated after an earlier analytics run — via the sheet-primary re-master — without a price
  change, so the analytics stays stale ("Maturity unknown") and the cron never re-selects it.

  Broaden the selector to also flag active bonds whose analytics is missing or not ok while the
  fields needed to compute it (maturity + coupon) ARE present. recomputeOne then computes them
  from the stored master and they drop out (ok=true). Bonds genuinely missing required data are
  excluded, so the sweep still terminates.
*/

CREATE OR REPLACE FUNCTION bm_stale_bonds(p_limit int DEFAULT 100)
RETURNS SETOF bm_bonds
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM bm_bonds
  WHERE active_status = 'active'
    AND (
      analytics_computed_at IS NULL
      OR price_updated_at > analytics_computed_at
      OR (
        (analytics IS NULL OR (analytics->>'ok') IS DISTINCT FROM 'true')
        AND maturity_date IS NOT NULL
        AND coupon_rate IS NOT NULL
      )
    )
  ORDER BY price_updated_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE ALL ON FUNCTION bm_stale_bonds(int) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION bm_stale_bonds(int) FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL; END $$;
GRANT EXECUTE ON FUNCTION bm_stale_bonds(int) TO service_role;
