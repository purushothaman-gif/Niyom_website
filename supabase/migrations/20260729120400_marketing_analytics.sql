/*
  # Marketing Tool — admin analytics RPCs

  Powers the Content Creation analytics dashboard: lifetime totals, the employee
  leaderboard, per-content performance and platform usage.

  ## Why every query spans two tables
  Approved content is hard-deleted 48 hours after it goes live, so a report built
  only on mkt_content would show yesterday's work vanishing from the numbers.
  Each RPC therefore reads mkt_content UNION mkt_content_history (the slim
  survivor row written immediately before deletion), de-duplicating on
  content_no. Usage tables (mkt_downloads, mkt_referral_clicks,
  mkt_lead_attributions) survive deletion on their own — their content FK nulls
  out but the denormalised content_no remains — so they join on content_no, not
  content_id.

  ## Access
  SECURITY DEFINER (they read across employee-scoped tables) with an explicit
  nw_current_emp_is_admin() guard as the first statement, and EXECUTE revoked
  from anon. Verified: a plain employee calling these raises
  "Admin access required".

  ## Safety
  Idempotent — CREATE OR REPLACE only, no schema or data changes.
*/

CREATE OR REPLACE FUNCTION mkt_dashboard_totals()
RETURNS TABLE (
  generated_total     bigint,
  approved_total      bigint,
  rejected_total      bigint,
  expired_total       bigint,
  admin_deleted_total bigint,
  downloads_total     bigint,
  caption_copies      bigint,
  hashtag_copies      bigint,
  referral_clicks     bigint,
  leads_generated     bigint,
  clients_onboarded   bigint,
  live_now            bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM (
       SELECT content_no FROM mkt_content
       UNION
       SELECT content_no FROM mkt_content_history) u),
    (SELECT count(*) FROM mkt_content WHERE status = 'approved')
      + (SELECT count(*) FROM mkt_content_history h
           WHERE h.approved_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM mkt_content c WHERE c.content_no = h.content_no)),
    (SELECT count(*) FROM mkt_content WHERE status = 'rejected')
      + (SELECT count(*) FROM mkt_content_history h
           WHERE h.final_status = 'rejected'
             AND NOT EXISTS (SELECT 1 FROM mkt_content c WHERE c.content_no = h.content_no)),
    (SELECT count(*) FROM mkt_content_history WHERE delete_reason = 'expired'),
    (SELECT count(*) FROM mkt_content_history WHERE delete_reason = 'admin_deleted'),
    (SELECT count(*) FROM mkt_downloads WHERE event_type IN ('download_poster','download_video')),
    (SELECT count(*) FROM mkt_downloads WHERE event_type = 'copy_caption'),
    (SELECT count(*) FROM mkt_downloads WHERE event_type = 'copy_hashtags'),
    (SELECT count(*) FROM mkt_referral_clicks),
    (SELECT count(*) FROM mkt_lead_attributions WHERE lead_id IS NOT NULL),
    (SELECT count(DISTINCT client_id) FROM mkt_lead_attributions WHERE client_id IS NOT NULL),
    (SELECT count(*) FROM mkt_content
       WHERE status = 'approved' AND expires_at > now()
         AND (scheduled_publish_at IS NULL OR scheduled_publish_at <= now()));
END;
$$;

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
    (SELECT count(*) FROM mkt_lead_attributions a WHERE a.employee_id = e.id AND a.lead_id IS NOT NULL),
    (SELECT count(DISTINCT a.client_id) FROM mkt_lead_attributions a
       WHERE a.employee_id = e.id AND a.client_id IS NOT NULL)
  FROM nw_employees e
  WHERE e.status = 'active'
  ORDER BY 9 DESC, 8 DESC, 5 DESC, e.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION mkt_content_performance(p_limit integer DEFAULT 20)
RETURNS TABLE (
  content_no   text,
  title        text,
  content_type text,
  platforms    text[],
  status       text,
  downloads    bigint,
  copies       bigint,
  clicks       bigint,
  leads        bigint,
  clients      bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH all_content AS (
    SELECT c.content_no, c.title, c.content_type, c.platforms, c.status
    FROM mkt_content c
    UNION ALL
    SELECT h.content_no, h.title, h.content_type, h.platforms,
           CASE WHEN h.delete_reason = 'expired' THEN 'expired' ELSE 'deleted' END
    FROM mkt_content_history h
    WHERE NOT EXISTS (SELECT 1 FROM mkt_content c2 WHERE c2.content_no = h.content_no)
  )
  SELECT a.content_no, a.title, a.content_type, a.platforms, a.status,
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.content_no = a.content_no AND d.event_type IN ('download_poster','download_video')),
    (SELECT count(*) FROM mkt_downloads d
       WHERE d.content_no = a.content_no AND d.event_type IN ('copy_caption','copy_hashtags','share_link')),
    (SELECT count(*) FROM mkt_referral_clicks rc WHERE rc.content_no = a.content_no),
    (SELECT count(*) FROM mkt_lead_attributions la
       WHERE la.content_no = a.content_no AND la.lead_id IS NOT NULL),
    (SELECT count(DISTINCT la.client_id) FROM mkt_lead_attributions la
       WHERE la.content_no = a.content_no AND la.client_id IS NOT NULL)
  FROM all_content a
  ORDER BY 6 DESC, 7 DESC, 8 DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

CREATE OR REPLACE FUNCTION mkt_platform_usage()
RETURNS TABLE (platform text, content_count bigint, downloads bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  WITH all_platforms AS (
    SELECT unnest(c.platforms) AS pl, c.content_no FROM mkt_content c
    UNION ALL
    SELECT unnest(h.platforms), h.content_no FROM mkt_content_history h
    WHERE NOT EXISTS (SELECT 1 FROM mkt_content c2 WHERE c2.content_no = h.content_no)
  )
  SELECT ap.pl, count(DISTINCT ap.content_no),
         (SELECT count(*) FROM mkt_downloads d WHERE d.platform = ap.pl)
  FROM all_platforms ap
  GROUP BY ap.pl
  ORDER BY 2 DESC;
END;
$$;

REVOKE ALL ON FUNCTION mkt_dashboard_totals()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mkt_employee_leaderboard()           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mkt_content_performance(integer)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mkt_platform_usage()                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION mkt_dashboard_totals()            TO authenticated;
GRANT EXECUTE ON FUNCTION mkt_employee_leaderboard()        TO authenticated;
GRANT EXECUTE ON FUNCTION mkt_content_performance(integer)  TO authenticated;
GRANT EXECUTE ON FUNCTION mkt_platform_usage()              TO authenticated;
