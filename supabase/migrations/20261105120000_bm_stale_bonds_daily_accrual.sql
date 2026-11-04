/*
  Accrued interest must roll forward every day, not only when a price changes.

  bm_stale_bonds picked a bond for recompute only when its price was newer than its
  analytics. Accrued interest (and the settlement date it is measured to) changes every
  calendar day, so a bond whose price sat unchanged for a week kept showing — and placing
  orders at — the accrued for a settlement date a week in the past.

  Now a bond is also stale when its analytics were last computed on an EARLIER India date
  than today. The 10-minute bond-yield-refresh cron therefore recomputes the whole active
  book once, shortly after midnight IST, then goes back to near-zero work.
*/
CREATE OR REPLACE FUNCTION bm_stale_bonds(p_limit int DEFAULT 100)
RETURNS SETOF bm_bonds
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT *
  FROM bm_bonds
  WHERE active_status = 'active'
    AND (
      analytics_computed_at IS NULL
      OR price_updated_at > analytics_computed_at
      OR (analytics_computed_at AT TIME ZONE 'Asia/Kolkata')::date < (now() AT TIME ZONE 'Asia/Kolkata')::date
      OR (
        (analytics IS NULL OR (analytics->>'ok') IS DISTINCT FROM 'true')
        AND maturity_date IS NOT NULL
        AND coupon_rate IS NOT NULL
      )
    )
  ORDER BY price_updated_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

REVOKE ALL ON FUNCTION bm_stale_bonds(int) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION bm_stale_bonds(int) FROM anon, authenticated';
END $$;
GRANT EXECUTE ON FUNCTION bm_stale_bonds(int) TO service_role;
