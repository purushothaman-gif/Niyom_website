/*
  # Partner Portal — referral links and lead submission

  ## Purpose
  Lets a partner share a referral link and submit leads directly, with both
  attributed back to them AND wired so the resulting business actually pays out.

  ## The critical bit
  public-onboard-start currently resolves a ref_code to an employee. For a
  partner code it must ALSO set the created client's `sourced_via = 'dsa'` and
  `dsa_id`, because src/crm/DSAPayout.tsx keys its entire payout calculation off
  those two columns. Without that, a partner-referred signup is attributed for
  analytics but generates zero payout — which is the whole point of the feature.
  (That change lives in the edge function; this migration provides the columns.)

  ## Tables
    mkt_referral_links    — + dsa_id, kind gains 'dsa', owner CHECK, unique index
    mkt_referral_clicks   — + dsa_id
    mkt_lead_attributions — + dsa_id (employee_id stays NOT NULL, see below)
    nw_leads              — + dsa_id, lead_origin gains 'partner_portal'

  ## Functions
    mkt_provision_dsa_referral_link()  — trigger fn, provisions on login-enable
    nw_partner_referral()              — the partner's own link + funnel counters
    nw_partner_leads()                 — leads they submitted, status SIMPLIFIED

  ## Why employee_id stays NOT NULL on mkt_lead_attributions
  Making it nullable would break mkt_employee_leaderboard() and
  mkt_company_channel_stats(), which are live. Partner-sourced rows therefore
  carry the DSA's owning RM (nw_dsa.employee_id) — which is nullable in prod, so
  the edge function coalesces to a house employee. Partner codes are then
  EXCLUDED from the employee leaderboard the same way company codes already are
  (see 20260729140000), so an RM is not credited for a partner's work.

  ## Why partners never read nw_leads directly
  The CRM status vocabulary has 18 values including 'Not Interested' and
  'Wrong Number'. Showing those verbatim to the partner who introduced the
  person is poor practice, so nw_partner_leads() maps them onto four states.

  ## Safety
    Idempotent. The lead_origin CHECK is widened to a strict SUPERSET of the
    existing list, so every current row still validates and the DROP + ADD in one
    implicit transaction leaves no unconstrained window. All column adds are
    nullable with no default backfill. No data is modified.
*/

-- ---------------------------------------------------------------------------
-- 1. mkt_referral_links — a third link kind.
--    The existing partial unique indexes make this collision-free:
--      employee: (employee_id) WHERE kind='employee' AND employee_id IS NOT NULL
--      company:  ((true))      WHERE kind='company'
--    A dsa row has employee_id NULL and kind='dsa', so it matches neither, and
--    mkt_provision_referral_link()'s ON CONFLICT arbiter still resolves.
--    The employee trigger therefore needs no change.
-- ---------------------------------------------------------------------------
ALTER TABLE mkt_referral_links
  ADD COLUMN IF NOT EXISTS dsa_id uuid REFERENCES nw_dsa(id) ON DELETE CASCADE;

ALTER TABLE mkt_referral_links DROP CONSTRAINT IF EXISTS mkt_referral_links_kind_check;
ALTER TABLE mkt_referral_links ADD CONSTRAINT mkt_referral_links_kind_check
  CHECK (kind IN ('employee', 'company', 'dsa'));

ALTER TABLE mkt_referral_links DROP CONSTRAINT IF EXISTS mkt_referral_links_owner_check;
ALTER TABLE mkt_referral_links ADD CONSTRAINT mkt_referral_links_owner_check
  CHECK (
    (kind = 'company'  AND employee_id IS NULL     AND dsa_id IS NULL)
    OR (kind = 'employee' AND employee_id IS NOT NULL AND dsa_id IS NULL)
    OR (kind = 'dsa'      AND employee_id IS NULL     AND dsa_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_referral_links_dsa_unique
  ON mkt_referral_links (dsa_id) WHERE kind = 'dsa' AND dsa_id IS NOT NULL;

-- Provision on login-enable rather than DSA creation, so codes exist only for
-- partners who can actually use them.
CREATE OR REPLACE FUNCTION mkt_provision_dsa_referral_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.dsa_login_enabled THEN
    INSERT INTO mkt_referral_links (employee_id, dsa_id, kind, label)
    VALUES (NULL, NEW.id, 'dsa', NEW.dsa_code)
    ON CONFLICT (dsa_id) WHERE kind = 'dsa' AND dsa_id IS NOT NULL
    DO NOTHING;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_mkt_dsa_referral_link ON nw_dsa;
CREATE TRIGGER trg_mkt_dsa_referral_link
  AFTER INSERT OR UPDATE OF dsa_login_enabled ON nw_dsa
  FOR EACH ROW EXECUTE FUNCTION mkt_provision_dsa_referral_link();

-- One SELECT policy covering all three readers, replacing the stale duplicate
-- pair flagged by the multiple_permissive_policies advisor.
DROP POLICY IF EXISTS "Employees read own referral link" ON mkt_referral_links;
DROP POLICY IF EXISTS mkt_referral_links_select            ON mkt_referral_links;
CREATE POLICY mkt_referral_links_select ON mkt_referral_links
  FOR SELECT TO authenticated
  USING (
    (SELECT nw_current_emp_is_admin())
    OR (kind = 'employee' AND employee_id = (SELECT nw_current_employee_id()))
    OR (kind = 'dsa'      AND dsa_id      = (SELECT nw_current_dsa_id()))
  );

-- ---------------------------------------------------------------------------
-- 2. Attribution columns.
-- ---------------------------------------------------------------------------
ALTER TABLE mkt_referral_clicks
  ADD COLUMN IF NOT EXISTS dsa_id uuid REFERENCES nw_dsa(id) ON DELETE SET NULL;

ALTER TABLE mkt_lead_attributions
  ADD COLUMN IF NOT EXISTS dsa_id uuid REFERENCES nw_dsa(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mkt_referral_clicks_dsa
  ON mkt_referral_clicks (dsa_id) WHERE dsa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mkt_lead_attributions_dsa
  ON mkt_lead_attributions (dsa_id) WHERE dsa_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. nw_leads — partner provenance.
-- ---------------------------------------------------------------------------
ALTER TABLE nw_leads
  ADD COLUMN IF NOT EXISTS dsa_id uuid REFERENCES nw_dsa(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nw_leads_dsa
  ON nw_leads (dsa_id) WHERE dsa_id IS NOT NULL;

-- Strict superset of the existing list, so the validating ADD cannot fail.
-- NOT VALID is deliberately not used: it would leave a permanently unvalidated
-- constraint, and nw_leads is small enough that the brief lock is a non-event.
ALTER TABLE nw_leads DROP CONSTRAINT IF EXISTS nw_leads_lead_origin_check;
ALTER TABLE nw_leads ADD CONSTRAINT nw_leads_lead_origin_check
  CHECK (lead_origin IN ('admin_upload', 'admin_manual', 'employee_manual',
                         'website_signup', 'partner_portal'));

-- ---------------------------------------------------------------------------
-- 4. Partner-facing RPCs.
-- ---------------------------------------------------------------------------

-- 4a. The partner's own link plus its funnel. Counts come from the attribution
--     tables directly, so this is a single round trip for the referral page.
CREATE OR REPLACE FUNCTION nw_partner_referral()
RETURNS TABLE (ref_code text, active boolean, clicks int, leads int, clients int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  RETURN QUERY
  SELECT l.ref_code, l.active,
         (SELECT COUNT(*) FROM mkt_referral_clicks c    WHERE c.dsa_id = v_dsa)::int,
         (SELECT COUNT(*) FROM mkt_lead_attributions a  WHERE a.dsa_id = v_dsa AND a.lead_id   IS NOT NULL)::int,
         (SELECT COUNT(*) FROM mkt_lead_attributions a2 WHERE a2.dsa_id = v_dsa AND a2.client_id IS NOT NULL)::int
  FROM mkt_referral_links l
  WHERE l.dsa_id = v_dsa AND l.kind = 'dsa'
  LIMIT 1;
END $fn$;

-- 4b. Leads this partner submitted or referred, with the CRM's 18-value status
--     workflow mapped down to four partner-appropriate states.
CREATE OR REPLACE FUNCTION nw_partner_leads()
RETURNS TABLE (
  lead_id uuid, lead_name text, mobile text, city text,
  status text, created_at timestamptz, converted_client_code text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  RETURN QUERY
  SELECT l.id, l.lead_name, l.mobile, l.city,
         CASE
           WHEN l.status = 'Closed - Converted' THEN 'Converted'
           WHEN l.status IN ('Lost', 'Closed - Rejected', 'Not Interested',
                             'Wrong Number')                THEN 'Closed'
           WHEN l.status = 'New'                            THEN 'Submitted'
           ELSE 'In Progress'
         END,
         l.created_at,
         c.client_code
  FROM nw_leads l
  LEFT JOIN nw_clients c ON c.id = l.converted_client_id
  WHERE l.dsa_id = v_dsa AND NOT l.is_archived
  ORDER BY l.created_at DESC;
END $fn$;

REVOKE ALL ON FUNCTION nw_partner_referral() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_leads()    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_partner_referral() TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_leads()    TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Keep the employee leaderboard honest: a partner's business is the
--    partner's, not their RM's. Generalises the company-code exclusion that
--    20260729140000 already established.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mkt_employee_leaderboard()
RETURNS TABLE(employee_id uuid, employee_code text, full_name text, avatar_url text,
              downloads bigint, copies bigint, clicks bigint, leads bigint, clients bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
  SELECT e.id, e.employee_code, e.full_name, e.avatar_url,
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.employee_id = e.id AND d.channel = 'employee'
         AND d.event_type IN ('download_poster','download_video')),
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.employee_id = e.id AND d.channel = 'employee'
         AND d.event_type IN ('copy_caption','copy_hashtags','share_link')),
    -- Clicks are keyed on employee_id, which partner clicks never set.
    (SELECT count(*) FROM mkt_referral_clicks c WHERE c.employee_id = e.id),
    -- Attribution rows DO carry the owning RM's employee_id (the column is NOT
    -- NULL), so partner-sourced business must be excluded explicitly here —
    -- exactly as 20260729140000 already excludes the company link.
    (SELECT count(*) FROM mkt_lead_attributions a
       WHERE a.employee_id = e.id AND a.lead_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM mkt_referral_links l
                           WHERE l.ref_code = a.ref_code AND l.kind IN ('company','dsa'))),
    (SELECT count(DISTINCT a.client_id) FROM mkt_lead_attributions a
       WHERE a.employee_id = e.id AND a.client_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM mkt_referral_links l
                           WHERE l.ref_code = a.ref_code AND l.kind IN ('company','dsa')))
  FROM nw_employees e
  WHERE e.status = 'active'
  ORDER BY 9 DESC, 8 DESC, 5 DESC, e.full_name;
END $fn$;

CREATE OR REPLACE FUNCTION mkt_dsa_channel_stats()
RETURNS TABLE (dsa_id uuid, dsa_code text, full_name text,
               clicks int, leads int, clients int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT d.id, d.dsa_code, d.full_name,
         (SELECT COUNT(*) FROM mkt_referral_clicks c    WHERE c.dsa_id = d.id)::int,
         (SELECT COUNT(*) FROM mkt_lead_attributions a  WHERE a.dsa_id = d.id AND a.lead_id   IS NOT NULL)::int,
         (SELECT COUNT(*) FROM mkt_lead_attributions a2 WHERE a2.dsa_id = d.id AND a2.client_id IS NOT NULL)::int
  FROM nw_dsa d
  WHERE d.dsa_login_enabled
  ORDER BY d.dsa_code;
END $fn$;

REVOKE ALL ON FUNCTION mkt_dsa_channel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mkt_dsa_channel_stats() TO authenticated;
