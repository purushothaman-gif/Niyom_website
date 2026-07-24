/*
  # Create news table for financial news

  1. New Tables
    - `news`
      - `id` (uuid, primary key) - Unique identifier for each news article
      - `title` (text, required) - News article headline
      - `description` (text) - Brief summary of the article
      - `content` (text) - Full article content
      - `url` (text) - Link to original article
      - `image_url` (text) - URL to article image
      - `source` (text) - News source name
      - `category` (text) - Category (IPO, stocks, commodities, etc.)
      - `published_at` (timestamptz) - When the article was published
      - `created_at` (timestamptz) - When it was added to our database
  
  2. Security
    - Enable RLS on `news` table
    - Add policy for authenticated users to read all news
    - Add policy for service role to insert/update news (via edge function)

  3. Indexes
    - Index on published_at for sorting
    - Index on category for filtering
*/

CREATE TABLE IF NOT EXISTS news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  content text,
  url text,
  image_url text,
  source text,
  category text DEFAULT 'general',
  published_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read news"
  ON news
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Service role can insert news"
  ON news
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update news"
  ON news
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS news_published_at_idx ON news(published_at DESC);
CREATE INDEX IF NOT EXISTS news_category_idx ON news(category);
CREATE INDEX IF NOT EXISTS news_url_idx ON news(url);