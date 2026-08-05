/*
  # What each scheme IS, for capital gains tax

  A mutual fund's gain is taxed by what the fund HOLDS. An equity-oriented fund
  (>=65% domestic equity) turns long-term at 12 months and is taxed at 12.5%
  above the ₹1.25L exemption; anything else takes 24 months; and a debt fund
  bought on or after 01-Apr-2023 is deemed short-term forever and taxed at slab.

  Nothing in our data answered that question. `cas_schemes.scheme_type` is blank
  on all 120 rows — a CAS never states a category — and `mf_scheme_cache.category`
  is empty on all 5,051. So a gains statement had no way to pick a rate.

  ## Where the answer comes from

  AMFI's NAVAll.txt, which the droplet already downloads every evening, groups
  schemes under category headings the parser used to discard:

    Open Ended Schemes(Equity Scheme - Large Cap Fund)
    119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla ...;100.7401;31-Jul-2026

  One extra regex over a file we already fetch, covering every scheme from every
  AMC, keyed by the ISIN a CAS carries. Measured against the book: 81 of the 82
  ISINs our clients hold get a category this way.

  ## Why an override column exists

  SEBI's category does not always fix the equity percentage. Multi Asset needs
  only 10% in each of three assets; Balanced Advantage is held above 65% by
  practice rather than mandate; a domestic FoF is taxed on what its underlying
  funds hold; and AMFI files debt index funds under "Other Scheme - Index Funds".
  Fourteen of the 82 held schemes sit in that set.

  For those, `ambiguous` is true and `effective_asset_class` stays NULL until a
  human sets `override_asset_class`. NULL means "we do not know" and the gains
  engine must show the gain without a tax treatment — never a plausible-looking
  default, which is a confident wrong number on somebody's tax return.
*/

CREATE TABLE IF NOT EXISTS mf_asset_class (
  isin text PRIMARY KEY,
  amfi_code text,
  scheme_name text,
  /* AMFI's heading verbatim, so any wrong call traces back to its source. */
  amfi_category text,
  /* Derived from the category. Meaningless on its own when `ambiguous`. */
  asset_class text CHECK (asset_class IN ('equity', 'debt', 'other')),
  ambiguous boolean NOT NULL DEFAULT false,

  /* Set by an administrator for the ambiguous ones. Always wins. */
  override_asset_class text CHECK (override_asset_class IN ('equity', 'debt', 'other')),
  override_note text,
  override_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  override_at timestamptz,

  updated_at timestamptz DEFAULT now(),

  /*
    The one column the gains engine reads. NULL is a real, meaningful answer:
    an ambiguous scheme with nobody's decision recorded against it.
  */
  effective_asset_class text GENERATED ALWAYS AS (
    COALESCE(override_asset_class, CASE WHEN ambiguous THEN NULL ELSE asset_class END)
  ) STORED
);

COMMENT ON TABLE mf_asset_class IS
  'Per-ISIN tax classification from AMFI category headings, with a manual override for categories that cannot determine the equity share. effective_asset_class NULL = undecided; do not tax.';

COMMENT ON COLUMN mf_asset_class.ambiguous IS
  'True when the AMFI category cannot fix the equity percentage (Multi Asset, Balanced Advantage, domestic FoF, Other-Index, solution-oriented, unrecognised).';

/* "Which held schemes still need a human decision" is the admin read pattern. */
CREATE INDEX IF NOT EXISTS idx_mf_asset_class_undecided
  ON mf_asset_class (isin) WHERE effective_asset_class IS NULL;

/*
  Published market reference data — AMFI's category list is on a public website
  with no login. Readable by any signed-in user (the portal needs it to show a
  client their own gains); writable only by the droplet's service role, which
  bypasses RLS, and by an admin recording an override through the RPC below.
*/
ALTER TABLE mf_asset_class ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mf_asset_class_read ON mf_asset_class;
CREATE POLICY mf_asset_class_read ON mf_asset_class
  FOR SELECT TO authenticated USING (true);

/*
  Recording an override is a tax decision, so it is an RPC rather than a table
  grant: it stamps who decided and when, and it cannot be used to rewrite the
  AMFI-derived facts alongside the decision.
*/
CREATE OR REPLACE FUNCTION nw_set_asset_class(
  p_isin text,
  p_asset_class text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  IF p_asset_class IS NOT NULL AND p_asset_class NOT IN ('equity', 'debt', 'other') THEN
    RAISE EXCEPTION 'asset class must be equity, debt or other (got %)', p_asset_class;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM nw_employees
    WHERE auth_user_id = auth.uid()
      AND status = 'active'
      AND role IN ('admin', 'super_admin')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'only an administrator may set a scheme''s tax classification';
  END IF;

  UPDATE mf_asset_class
     SET override_asset_class = p_asset_class,
         override_note        = p_note,
         override_by          = auth.uid(),
         override_at          = now(),
         updated_at           = now()
   WHERE isin = p_isin;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no scheme with ISIN %', p_isin;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION nw_set_asset_class(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nw_set_asset_class(text, text, text) TO authenticated;

COMMENT ON FUNCTION nw_set_asset_class IS
  'Admin-only: record a human decision on a scheme whose AMFI category cannot determine its equity share.';
