-- ---------------------------------------------------------------------------
-- News feed: cap retention at 20 articles per category.
--
-- The public News page now refreshes automatically on every open (no manual
-- "Refresh feed" button). To keep the feed lean and fresh, we retain only the
-- newest 20 articles per category — as new stories are ingested, the oldest in
-- each category are auto-deleted. Enforced on every ingest by the
-- `fetch-financial-news` edge function, plus a daily cron as a safety net.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prune_news_to_cap(max_per_category integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY category
             ORDER BY published_at DESC, created_at DESC
           ) AS rn
    FROM news
  )
  DELETE FROM news WHERE id IN (SELECT id FROM ranked WHERE rn > max_per_category);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION prune_news_to_cap(integer) TO service_role;

-- Schedule the per-category cap daily at 02:15 UTC (just after delete_old_news
-- at 02:00) when pg_cron is available.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('prune-news-per-category-daily', '15 2 * * *', 'SELECT prune_news_to_cap(20);');
  END IF;
END $$;
