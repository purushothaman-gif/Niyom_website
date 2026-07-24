/*
  # Auto-delete old news articles

  1. Changes
    - Create a function to delete news articles older than 30 days
    - Schedule this function to run daily using pg_cron
    - Ensures news feed stays fresh and relevant

  2. Function Details
    - `delete_old_news()` - Removes news articles where published_at is older than 30 days
    - Returns the count of deleted articles for monitoring

  3. Scheduling
    - Runs daily at 2:00 AM UTC
    - Helps maintain database performance by keeping the news table lean
*/

-- Create function to delete old news
CREATE OR REPLACE FUNCTION delete_old_news()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM news
  WHERE published_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule the function to run daily at 2:00 AM UTC
SELECT cron.schedule(
  'delete-old-news-daily',
  '0 2 * * *',
  'SELECT delete_old_news();'
);
