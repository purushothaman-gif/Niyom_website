/*
  # Remove Duplicate News Articles and Prevent Future Duplicates

  ## Changes Made
  
  1. **Remove Duplicates**
     - Identifies and removes duplicate news articles based on URL
     - Keeps only the most recent entry (by created_at) for each unique URL
  
  2. **Add Unique Constraint**
     - Adds a unique constraint on the `url` column to prevent duplicate articles
     - Ensures each news article URL can only exist once in the database
  
  ## Important Notes
  
  - This migration will permanently delete duplicate entries
  - Only the newest version of each duplicate article will be retained
  - The unique constraint will prevent the edge function from inserting duplicates in the future
*/

-- Step 1: Delete duplicate entries, keeping only the most recent one for each URL
DELETE FROM news a
USING news b
WHERE a.id < b.id 
  AND a.url = b.url;

-- Step 2: Add unique constraint on URL to prevent future duplicates
ALTER TABLE news 
ADD CONSTRAINT news_url_unique UNIQUE (url);