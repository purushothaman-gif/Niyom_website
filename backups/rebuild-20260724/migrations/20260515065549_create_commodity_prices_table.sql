/*
  # Create Commodity Prices Table

  ## Summary
  Stores daily MCX gold and silver spot prices for educational display.

  ## New Tables
  - `commodity_prices`
    - `id` (uuid, primary key)
    - `commodity` (text) — 'gold' or 'silver'
    - `price` (numeric) — price in INR (gold per 10g, silver per kg)
    - `price_date` (date) — the trading date
    - `source` (text) — source label e.g. 'MCX'
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - Public SELECT allowed (educational data, no PII)
  - INSERT/UPDATE only by service role (edge functions)

  ## Notes
  - Unique constraint on (commodity, price_date) prevents duplicate entries
  - Index on price_date for fast range queries by month
*/

CREATE TABLE IF NOT EXISTS commodity_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity text NOT NULL CHECK (commodity IN ('gold', 'silver')),
  price numeric NOT NULL,
  price_date date NOT NULL,
  source text NOT NULL DEFAULT 'MCX',
  created_at timestamptz DEFAULT now(),
  UNIQUE (commodity, price_date)
);

ALTER TABLE commodity_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read commodity prices"
  ON commodity_prices
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_commodity_prices_date ON commodity_prices (price_date DESC);
CREATE INDEX IF NOT EXISTS idx_commodity_prices_commodity ON commodity_prices (commodity, price_date DESC);
