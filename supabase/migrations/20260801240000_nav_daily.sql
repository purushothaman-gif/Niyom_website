/*
  # Daily NAV history

  An imported statement is a snapshot: the units are as at its date and so is
  the value. Without a NAV feed a client's portfolio is frozen on the day they
  imported it, which is the single biggest thing wrong with a CAS-only picture.

  ## Why AMFI and not BSE

  BSE StAR MF is the ORDER rail, and a distributor cannot transact direct plans
  on it — five of the six holdings on the first real import are Direct Plans.
  `get_mis_detail` already answers `authz` for our member tier, so entitlement
  to `nav_master_list` is not safe to assume either.

  AMFI publishes NAVAll.txt daily, free and unauthenticated, covering every
  scheme from every AMC including direct plans, keyed by ISIN — the same key a
  CAS carries. Checked against the real holdings: all five ISINs present, and
  the NAVs match the statement to the last decimal (461.6166, 32.3078, 139.209,
  69.027, 57.950).

  ## Why history rather than a single current value

  Storing one row per ISIN per day costs almost nothing and is the difference
  between "what is it worth" and "what did it do today". Day change has been
  missing from the dashboard since launch for exactly this reason.

  ## What this does NOT make current

  Units. Those still come from the statement, so a client who has transacted
  since importing has fresh prices on stale quantities — which is what
  cas_requests' staleness check already warns about. Revaluing is an
  improvement on a frozen figure, not a substitute for a newer statement.
*/

CREATE TABLE IF NOT EXISTS nav_daily (
  isin text NOT NULL,
  nav_date date NOT NULL,
  nav numeric NOT NULL,
  /* AMFI's own scheme name and code, kept for diagnosis when an ISIN looks wrong. */
  scheme_name text,
  amfi_code text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (isin, nav_date)
);

COMMENT ON TABLE nav_daily IS
  'Daily NAV per ISIN from AMFI''s public NAVAll.txt. Market data, not client data.';

/* "The latest NAV for these ISINs" is the only read pattern that matters. */
CREATE INDEX IF NOT EXISTS idx_nav_daily_isin_date ON nav_daily(isin, nav_date DESC);

/*
  Published market data — every mutual fund NAV in India is on AMFI's website
  without a login. There is nothing here to scope to a client, so any signed-in
  user may read it and nobody may write it from a browser; the refresh runs on
  the droplet with the service role.
*/
ALTER TABLE nav_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nav_daily_read ON nav_daily;
CREATE POLICY nav_daily_read ON nav_daily FOR SELECT TO authenticated USING (true);

/*
  One row per refresh, so a silent failure is visible. A NAV feed that quietly
  stops updating shows a client stale prices that look current, which is worse
  than showing none.
*/
CREATE TABLE IF NOT EXISTS nav_refresh_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  rows_parsed int,
  rows_written int,
  nav_date date,
  error text
);

COMMENT ON TABLE nav_refresh_log IS
  'Audit of each AMFI NAV refresh. /health surfaces the most recent so a stalled feed is noticeable.';

ALTER TABLE nav_refresh_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nav_refresh_log_read ON nav_refresh_log;
CREATE POLICY nav_refresh_log_read ON nav_refresh_log FOR SELECT TO authenticated USING (true);
