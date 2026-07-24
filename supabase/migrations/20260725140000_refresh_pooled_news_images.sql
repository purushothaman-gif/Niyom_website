-- One-time cleanup: earlier IPO / mutual-funds rows (sourced from Google News,
-- which carries no image) were all stored with a single hardcoded fallback
-- image, so every card in those categories looked identical. The
-- fetch-financial-news function now assigns a deterministic per-article image
-- from a category pool (pooled URLs carry an `auto=compress` query param).
--
-- Remove the stale single-image rows so the function re-inserts them with the
-- varied pooled images on the next fetch. No-op on a fresh database.
DELETE FROM news
WHERE category IN ('IPO', 'mutual funds')
  AND (image_url IS NULL OR image_url NOT LIKE '%auto=compress%');
