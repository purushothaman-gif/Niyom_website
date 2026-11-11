/*
  # DEMAT holdings import (CDSL / NSDL eCAS)

  A client's eCAS (electronic Consolidated Account Statement) from CDSL or NSDL
  is the authoritative record of everything they hold in DEMAT form — listed
  equities, corporate bonds, government securities, AIFs, NPS, ETFs and
  demat-held mutual funds — across BOTH depositories (a CDSL eCAS carries NSDL
  holdings too, and vice versa).

  ## Why a parallel table family, exactly like cas_*

  This mirrors the mutual-fund CAS design (cas_imports / cas_folios /
  cas_schemes) on purpose. These tables are deliberately SEPARATE from
  nw_holdings: that table is hand-maintained by staff, carries DSA pricing and
  trail fields, and is gated by a product_type CHECK that knows nothing of
  listed equities or G-secs. An eCAS knows nothing of DSA pricing. The portal
  reads demat assets from HERE and overlays them onto the board at render time,
  the same way mutual funds are read from cas_*. Nothing here is ever written
  into nw_holdings.

  Clients are matched on PAN, the only key an eCAS shares with nw_clients.

  ## What an eCAS is NOT

  Unlike a DETAILED mutual-fund CAS, an eCAS is a HOLDINGS SNAPSHOT as on a
  date — it carries no transaction ledger. So there is no demat_transactions
  table and no realised capital-gains path from this source; value and units
  are point-in-time. That is a property of the document, not a gap to fill here.
*/

/* ------------------------------------------------------------------ imports */

CREATE TABLE IF NOT EXISTS demat_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,
  /* Kept even when no client matches, so an unmatched PAN is diagnosable. */
  investor_pan text,
  investor_name text,

  /* Provenance. */
  source text NOT NULL DEFAULT 'cdsl_otp',          -- cdsl_otp | upload | email
  cas_type text,                                    -- CDSL | NSDL (the issuing depository)
  statement_date date,                              -- the "as on" date of the snapshot
  file_name text,
  file_sha256 text,

  status text NOT NULL DEFAULT 'parsing',           -- parsing | parsed | failed
  total_value numeric,                              -- summary total the statement reports
  account_count int DEFAULT 0,
  holding_count int DEFAULT 0,
  error text,

  created_at timestamptz DEFAULT now(),
  created_by uuid                                   -- employee, when staff-initiated
);

COMMENT ON TABLE demat_imports IS
  'One row per eCAS parsed. status=parsed means the statement was read and stored; the app reads only parsed imports.';

/* ----------------------------------------------------------------- accounts */

CREATE TABLE IF NOT EXISTS demat_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES demat_imports(id) ON DELETE CASCADE,
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,

  depository text,                                  -- CDSL | NSDL
  dp_id text,
  dp_name text,
  bo_id text,                                       -- 16-digit CDSL client id, or NSDL IN… id
  value numeric,

  created_at timestamptz DEFAULT now()
);

/* ----------------------------------------------------------------- holdings */

CREATE TABLE IF NOT EXISTS demat_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES demat_imports(id) ON DELETE CASCADE,
  account_id uuid REFERENCES demat_accounts(id) ON DELETE CASCADE,
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,

  /*
   * The asset taxonomy the eCAS distinguishes. Kept as a constrained text
   * column (not an enum) so a new class an RTA starts reporting is a one-line
   * CHECK change, not an ALTER TYPE. 'other' is the honest bucket for anything
   * the parser cannot place rather than dropping it.
   */
  asset_class text NOT NULL DEFAULT 'other'
    CHECK (asset_class IN ('equity','corporate_bond','gsec','aif','nps','etf','demat_mf','other')),

  isin text,
  name text NOT NULL,
  units numeric,
  value numeric,

  /* Class-specific fields the statement carries (coupon, maturity, PRAN, …). */
  extra jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now()
);

/* -------------------------------------------------------------------- index */

CREATE INDEX IF NOT EXISTS idx_demat_imports_client ON demat_imports(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demat_imports_pan ON demat_imports(investor_pan);
/* The same statement re-imported is a no-op rather than a duplicate snapshot. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_demat_imports_file ON demat_imports(client_id, file_sha256)
  WHERE file_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_demat_imports_snapshot
  ON demat_imports(client_id, cas_type, statement_date)
  WHERE client_id IS NOT NULL AND statement_date IS NOT NULL AND status = 'parsed';
CREATE INDEX IF NOT EXISTS idx_demat_accounts_import ON demat_accounts(import_id);
CREATE INDEX IF NOT EXISTS idx_demat_holdings_import ON demat_holdings(import_id);
CREATE INDEX IF NOT EXISTS idx_demat_holdings_client ON demat_holdings(client_id);

/* ---------------------------------------------------------------------- RLS */

ALTER TABLE demat_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE demat_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE demat_holdings ENABLE ROW LEVEL SECURITY;

/*
  Same trust model as cas_*: a client may read only their own demat data; staff
  read via the service role from the server; nothing is writable from a browser
  session. (select auth.uid()) once-per-query, not per-row (initplan fix).
*/
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['demat_imports','demat_accounts','demat_holdings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (client_id IN (
        SELECT id FROM nw_clients WHERE client_auth_user_id = (select auth.uid())
      ))
    $f$, t || '_own_read', t);
  END LOOP;
END $$;
