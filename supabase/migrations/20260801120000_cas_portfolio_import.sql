/*
  # Consolidated Account Statement (CAS) import

  A client's CAS is the authoritative record of everything they hold in mutual
  funds — across every AMC and both RTAs — including funds bought elsewhere.
  BSE never supplies this: it is the order rail, not the portfolio one.

  These tables are deliberately SEPARATE from nw_holdings. That table is
  hand-maintained by staff and spans bonds, insurance and unlisted shares, and
  carries DSA pricing and trail fields. A CAS knows nothing about any of that,
  so importing into it would destroy data. The portal reads mutual funds from
  here and everything else from nw_holdings.

  Clients are matched on PAN, the only key a CAS shares with nw_clients.

  ## Trust model

  A CAS states its own totals. Every import is reconciled against them and the
  outcome recorded on cas_imports: a parser that drifts as RTAs change their
  layout returns PARTIAL data rather than failing, and partial data on a screen
  showing someone's savings is worse than no data. An import that does not
  reconcile is kept for diagnosis but never marked authoritative, and the app
  reads only from reconciled imports.
*/

/* ------------------------------------------------------------------ imports */

CREATE TABLE IF NOT EXISTS cas_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,
  /* Kept even when no client matches, so an unmatched PAN is diagnosable. */
  investor_pan text,
  investor_name text,
  investor_email text,

  /* Provenance. */
  source text NOT NULL DEFAULT 'client_upload',   -- client_upload | staff_upload | email
  cas_type text,                                   -- CAMS_KFINTECH | CDSL | NSDL
  statement_from date,
  statement_to date,
  file_name text,
  file_sha256 text,                                -- dedupe: same statement twice is a no-op

  /* Reconciliation — the whole point. */
  status text NOT NULL DEFAULT 'parsing',          -- parsing | reconciled | mismatch | failed
  stated_total numeric,                            -- the total the PDF itself prints
  parsed_total numeric,                            -- what our parser summed
  variance numeric,                                -- parsed - stated
  folio_count int DEFAULT 0,
  scheme_count int DEFAULT 0,
  transaction_count int DEFAULT 0,
  error text,

  created_at timestamptz DEFAULT now(),
  created_by uuid                                  -- employee, when staff-uploaded
);

COMMENT ON TABLE cas_imports IS
  'One row per CAS parsed. status=reconciled means parsed totals matched the totals printed in the document; only those are read by the app.';
COMMENT ON COLUMN cas_imports.file_sha256 IS
  'Hash of the uploaded PDF. Re-importing the same statement is a no-op rather than a duplicate.';

/* ------------------------------------------------------------------- folios */

CREATE TABLE IF NOT EXISTS cas_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES cas_imports(id) ON DELETE CASCADE,
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,
  folio_number text NOT NULL,
  amc text,
  registrar text,                                  -- CAMS | KFINTECH
  value numeric,
  created_at timestamptz DEFAULT now()
);

/* ------------------------------------------------------------------ schemes */

CREATE TABLE IF NOT EXISTS cas_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES cas_imports(id) ON DELETE CASCADE,
  folio_id uuid NOT NULL REFERENCES cas_folios(id) ON DELETE CASCADE,
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,

  isin text,
  amfi_code text,
  rta text,
  rta_code text,
  name text NOT NULL,
  scheme_type text,                                -- EQUITY | DEBT | HYBRID | OTHER

  units numeric,
  nav numeric,
  nav_date date,
  value numeric,
  cost numeric,
  gain_absolute numeric,
  gain_percent numeric,

  /*
   * The ARN/RIA code the CAS attributes the holding to. This is what separates
   * assets we advise on from held-away ones — clients see everything, our own
   * AUM counts only ARN-362707.
   */
  advisor_code text,
  is_ours boolean GENERATED ALWAYS AS (advisor_code IS NOT NULL AND advisor_code ILIKE '%362707%') STORED,

  created_at timestamptz DEFAULT now()
);

COMMENT ON COLUMN cas_schemes.is_ours IS
  'True when the CAS attributes this holding to ARN-362707. Drives the "held away" marker and keeps console AUM honest.';

/* ------------------------------------------------------------- transactions */

CREATE TABLE IF NOT EXISTS cas_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES cas_imports(id) ON DELETE CASCADE,
  scheme_id uuid NOT NULL REFERENCES cas_schemes(id) ON DELETE CASCADE,
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,

  txn_date date NOT NULL,
  description text,
  txn_type text,                                   -- PURCHASE | REDEMPTION | SWITCH_IN | SWITCH_OUT | DIVIDEND | ...
  amount numeric,
  units numeric,
  nav numeric,
  balance_units numeric,
  dividend_rate numeric,
  stamp_duty numeric,

  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE cas_transactions IS
  'Transaction ledger from a DETAILED CAS. A summary CAS carries holdings only, so capital gains and XIRR need a detailed statement.';

/* -------------------------------------------------------------------- index */

CREATE INDEX IF NOT EXISTS idx_cas_imports_client ON cas_imports(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cas_imports_pan ON cas_imports(investor_pan);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cas_imports_file ON cas_imports(client_id, file_sha256)
  WHERE file_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cas_folios_import ON cas_folios(import_id);
CREATE INDEX IF NOT EXISTS idx_cas_schemes_import ON cas_schemes(import_id);
CREATE INDEX IF NOT EXISTS idx_cas_schemes_client ON cas_schemes(client_id);
CREATE INDEX IF NOT EXISTS idx_cas_txn_scheme ON cas_transactions(scheme_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_cas_txn_client ON cas_transactions(client_id, txn_date DESC);

/* ---------------------------------------------------------------------- RLS */

ALTER TABLE cas_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE cas_folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE cas_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cas_transactions ENABLE ROW LEVEL SECURITY;

/*
  A CAS is the most sensitive document we hold — a client's entire financial
  life, including assets nothing to do with us. A client may read only their
  own; staff read via the service role from the server. Nothing is writable
  from a browser session.

  (select auth.uid()) rather than auth.uid() so the planner evaluates it once
  per query instead of once per row — the same initplan fix applied across the
  rest of this schema.
*/
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cas_imports','cas_folios','cas_schemes','cas_transactions']
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
