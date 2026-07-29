-- Marketing Tool: separate company-channel downloads from employee downloads.
--
-- Admins can now download approved artwork and copy captions for posting on
-- NIYOM's own social accounts. Those actions are performed by a person who also
-- has an nw_employees row, so without a marker they would land in that person's
-- mkt_downloads tally and inflate their leaderboard position — the same problem
-- already solved for leads by the company referral link.
--
-- mkt_downloads therefore records WHICH channel the action belongs to. The
-- employee leaderboard counts only 'employee' rows; company activity is
-- reported by mkt_company_channel_stats() alongside its clicks and leads.
--
-- Existing rows predate the admin gallery and are all genuine employee activity,
-- so the 'employee' default backfills them correctly.

ALTER TABLE mkt_downloads
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'employee';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mkt_downloads_channel_check'
  ) THEN
    ALTER TABLE mkt_downloads
      ADD CONSTRAINT mkt_downloads_channel_check
      CHECK (channel IN ('employee', 'company'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mkt_downloads_channel
  ON mkt_downloads (channel, created_at DESC);

-- An employee may only ever write their own rows, and only on their own
-- channel: without the channel clause anyone could hide their activity from the
-- leaderboard by claiming it was company work. Admins may write either.
DROP POLICY IF EXISTS mkt_downloads_insert ON mkt_downloads;
CREATE POLICY mkt_downloads_insert ON mkt_downloads
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = nw_current_employee_id()
    AND (channel = 'employee' OR nw_current_emp_is_admin())
  );

-- ---------------------------------------------------------------------------
-- Leaderboard counts employee activity only
-- ---------------------------------------------------------------------------

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
       WHERE d.employee_id = e.id AND d.channel = 'employee'
         AND d.event_type IN ('download_poster','download_video')),
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.employee_id = e.id AND d.channel = 'employee'
         AND d.event_type IN ('copy_caption','copy_hashtags','share_link')),
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
-- Company channel reports its own downloads and copies
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mkt_company_channel_stats()
RETURNS TABLE (
  ref_code  text,
  label     text,
  active    boolean,
  downloads bigint,
  copies    bigint,
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
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.channel = 'company'
         AND d.event_type IN ('download_poster','download_video')),
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.channel = 'company'
         AND d.event_type IN ('copy_caption','copy_hashtags','share_link')),
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
