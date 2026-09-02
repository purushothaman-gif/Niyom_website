/*
  # Let the render worker pick up approved content that has no artwork

  ## The hole

  mkt_auto_claim_render only claimed slots in 'generated' or 'flagged', on the
  assumption that approval always happens AFTER rendering — which is true when
  the pipeline is healthy, because finalize() renders first and approves second.

  It is not true when an admin approves by hand. During the render outage that
  ran from mid-August, content generated every morning with no artwork and was
  approved manually so it would at least reach employees as text. Those slots
  moved straight to 'approved', which the claim query treats as terminal, so
  once the worker came back it could never fill in the missing artwork. The
  content was live, permanently image-less, and invisible to the one process
  able to fix it.

  ## The fix

  Also claim 'approved' slots whose content has no assets at all. That is a
  precise description of the broken case and nothing else: a healthy slot is
  only approved by finalize(), which has by then uploaded its assets, so it can
  never match. Partial renders are deliberately excluded — a slot with some
  assets is either mid-flight or already fine, and re-rendering it would churn
  storage for no gain.
*/

CREATE OR REPLACE FUNCTION mkt_auto_claim_render(p_run_date date, p_limit integer DEFAULT 3)
RETURNS SETOF mkt_auto_slots
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE mkt_auto_slots s
  SET state = 'rendering', render_attempts = s.render_attempts + 1
  WHERE s.id IN (
    SELECT c.id FROM mkt_auto_slots c
    WHERE c.run_date = p_run_date
      AND c.content_id IS NOT NULL
      AND c.render_attempts < 3
      AND (
        c.state IN ('generated', 'flagged')
        -- Approved by a human before the artwork existed. See the header.
        OR (
          c.state = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM mkt_content_assets a WHERE a.content_id = c.content_id
          )
        )
      )
    ORDER BY c.slot_no
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING s.*;
END;
$$;

REVOKE ALL ON FUNCTION mkt_auto_claim_render(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mkt_auto_claim_render(date, integer) TO service_role;
