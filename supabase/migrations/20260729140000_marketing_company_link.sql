-- Marketing Tool: a company referral link for NIYOM's own social accounts.
--
-- Employees post approved content from their personal accounts and get credited
-- through their own link. NIYOM also posts from its official accounts, and those
-- signups belong to nobody in particular — crediting them to whoever happens to
-- be the admin would put company-channel performance on that person's row and
-- make the employee leaderboard meaningless as a comparison.
--
-- So the company link is a distinct row:
--   * kind = 'company', employee_id = NULL
--   * onboarding resolves it to no employee, which lands the client on the house
--     default (NIYOM-001) exactly as a walk-in does
--   * analytics exclude it from the employee leaderboard and report it as its
--     own channel instead
--
-- employee_id has to become nullable for this, which means the UNIQUE that
-- guaranteed one link per employee is replaced by a partial unique index over
-- employee rows only. The provisioning trigger's ON CONFLICT target moves with
-- it — a bare ON CONFLICT (employee_id) no longer matches a partial index and
-- would fail at runtime on the next hire.

-- ---------------------------------------------------------------------------
-- 1. Widen the table
-- ---------------------------------------------------------------------------

ALTER TABLE mkt_referral_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'employee';

ALTER TABLE mkt_referral_links
  ADD COLUMN IF NOT EXISTS label text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mkt_referral_links_kind_check'
  ) THEN
    ALTER TABLE mkt_referral_links
      ADD CONSTRAINT mkt_referral_links_kind_check
      CHECK (kind IN ('employee', 'company'));
  END IF;
END $$;

-- A company link has no owning employee.
ALTER TABLE mkt_referral_links ALTER COLUMN employee_id DROP NOT NULL;

-- Replace the whole-column UNIQUE with one scoped to employee links.
ALTER TABLE mkt_referral_links DROP CONSTRAINT IF EXISTS mkt_referral_links_employee_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_referral_links_employee_unique
  ON mkt_referral_links (employee_id)
  WHERE kind = 'employee' AND employee_id IS NOT NULL;

-- At most one company link, so "the" company link is unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_referral_links_company_unique
  ON mkt_referral_links ((true))
  WHERE kind = 'company';

-- A company link must not carry an owner, and an employee link must.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mkt_referral_links_owner_check'
  ) THEN
    ALTER TABLE mkt_referral_links
      ADD CONSTRAINT mkt_referral_links_owner_check
      CHECK (
        (kind = 'company'  AND employee_id IS NULL) OR
        (kind = 'employee' AND employee_id IS NOT NULL)
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Keep the provisioning trigger working against the partial index
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mkt_provision_referral_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- ON CONFLICT must name the partial index's predicate; a bare
  -- ON CONFLICT (employee_id) no longer has a matching arbiter and errors.
  INSERT INTO mkt_referral_links (employee_id, kind)
  VALUES (NEW.id, 'employee')
  ON CONFLICT (employee_id) WHERE kind = 'employee' AND employee_id IS NOT NULL
  DO NOTHING;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Create the company link
-- ---------------------------------------------------------------------------

INSERT INTO mkt_referral_links (employee_id, kind, label)
SELECT NULL, 'company', 'NIYOM official channels'
WHERE NOT EXISTS (SELECT 1 FROM mkt_referral_links WHERE kind = 'company');

-- ---------------------------------------------------------------------------
-- 4. Keep company traffic out of the employee leaderboard
-- ---------------------------------------------------------------------------
--
-- Clicks need no change: mkt_referral_clicks.employee_id is resolved from the
-- link, so a company click carries NULL and already fails the employee join.
--
-- Lead attributions do: mkt_lead_attributions.employee_id is NOT NULL and a
-- company signup lands on the house employee, so without this those rows would
-- count toward that person's leads and clients. Excluded by ref_code.

CREATE OR REPLACE FUNCTION mkt_employee_leaderboard()
RETURNS TABLE (
  employee_id   uuid,
  employee_code text,
  full_name     text,
  avatar_url    text,
  downloads     bigint,
  copies        bigint,
  clicks        bigint,
  leads         bigint,
  clients       bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT e.id, e.employee_code, e.full_name, e.avatar_url,
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.employee_id = e.id AND d.event_type IN ('download_poster','download_video')),
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.employee_id = e.id AND d.event_type IN ('copy_caption','copy_hashtags','share_link')),
    (SELECT count(*) FROM mkt_referral_clicks c WHERE c.employee_id = e.id),
    (SELECT count(*) FROM mkt_lead_attributions a
       WHERE a.employee_id = e.id AND a.lead_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM mkt_referral_links l
                           WHERE l.ref_code = a.ref_code AND l.kind = 'company')),
    (SELECT count(DISTINCT a.client_id) FROM mkt_lead_attributions a
       WHERE a.employee_id = e.id AND a.client_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM mkt_referral_links l
                           WHERE l.ref_code = a.ref_code AND l.kind = 'company'))
  FROM nw_employees e
  WHERE e.status = 'active'
  ORDER BY 9 DESC, 8 DESC, 5 DESC, e.full_name;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Report the company channel as its own line
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mkt_company_channel_stats()
RETURNS TABLE (
  ref_code  text,
  label     text,
  active    boolean,
  clicks    bigint,
  leads     bigint,
  clients   bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT l.ref_code, l.label, l.active,
    (SELECT count(*) FROM mkt_referral_clicks c WHERE c.ref_code = l.ref_code),
    (SELECT count(*) FROM mkt_lead_attributions a
       WHERE a.ref_code = l.ref_code AND a.lead_id IS NOT NULL),
    (SELECT count(DISTINCT a.client_id) FROM mkt_lead_attributions a
       WHERE a.ref_code = l.ref_code AND a.client_id IS NOT NULL)
  FROM mkt_referral_links l
  WHERE l.kind = 'company';
END $$;

REVOKE ALL ON FUNCTION mkt_company_channel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mkt_company_channel_stats() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admins can read the company link; employees only ever see their own
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS mkt_referral_links_select ON mkt_referral_links;
CREATE POLICY mkt_referral_links_select ON mkt_referral_links
  FOR SELECT TO authenticated
  USING (
    nw_current_emp_is_admin()
    OR (kind = 'employee' AND employee_id = nw_current_employee_id())
  );
