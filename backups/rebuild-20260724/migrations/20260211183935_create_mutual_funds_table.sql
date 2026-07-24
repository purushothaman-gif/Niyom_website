/*
  # Create mutual funds table for MF research

  1. New Tables
    - `mutual_funds`
      - `id` (uuid, primary key) - Unique identifier
      - `fund_name` (text, required) - Name of the mutual fund
      - `fund_code` (text) - Unique fund identifier/code
      - `category` (text) - Fund category (Equity, Debt, Hybrid, etc.)
      - `sub_category` (text) - Sub-category (Large Cap, Mid Cap, etc.)
      - `aum` (numeric) - Assets Under Management in crores
      - `expense_ratio` (numeric) - Expense ratio percentage
      - `return_1y` (numeric) - 1 year return percentage
      - `return_3y` (numeric) - 3 year return percentage
      - `return_5y` (numeric) - 5 year return percentage
      - `launch_date` (date) - Fund launch date
      - `risk_level` (text) - Risk level (Low, Moderate, High)
      - `min_investment` (numeric) - Minimum investment amount
      - `fund_manager` (text) - Fund manager name
      - `updated_at` (timestamptz) - Last update timestamp
      - `created_at` (timestamptz) - Record creation timestamp
  
  2. Security
    - Enable RLS on `mutual_funds` table
    - Add policy for anyone to read mutual funds data
    - Add policy for service role to insert/update funds

  3. Indexes
    - Index on category for filtering
    - Index on return_1y for sorting by performance
    - Index on fund_code for lookups
*/

CREATE TABLE IF NOT EXISTS mutual_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_name text NOT NULL,
  fund_code text UNIQUE,
  category text DEFAULT 'Equity',
  sub_category text,
  aum numeric DEFAULT 0,
  expense_ratio numeric DEFAULT 0,
  return_1y numeric DEFAULT 0,
  return_3y numeric DEFAULT 0,
  return_5y numeric DEFAULT 0,
  launch_date date,
  risk_level text DEFAULT 'Moderate',
  min_investment numeric DEFAULT 500,
  fund_manager text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mutual_funds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read mutual funds"
  ON mutual_funds
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Service role can insert mutual funds"
  ON mutual_funds
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update mutual funds"
  ON mutual_funds
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS mutual_funds_category_idx ON mutual_funds(category);
CREATE INDEX IF NOT EXISTS mutual_funds_return_1y_idx ON mutual_funds(return_1y DESC);
CREATE INDEX IF NOT EXISTS mutual_funds_fund_code_idx ON mutual_funds(fund_code);