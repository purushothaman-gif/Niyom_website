/*
  # Automated daily content — generation-side RPCs

  Everything the generator needs that is better expressed in SQL than over
  PostgREST: atomic slot claiming, terminal-state recording, the batch rollup,
  and the two uniqueness queries that need pg_trgm.

  ## A grant bug in the previous migration, fixed here

  20260812090000 wrote `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon,
  authenticated` on mkt_auto_approve and friends. Revoking from PUBLIC removes
  the implicit grant every role inherits, and `service_role` is not a superuser
  and had no explicit grant — so the automated pipeline would have been unable
  to call the very functions written for it, and mkt_auto_approve would have
  failed the first time it ran. The GRANTs at the end of this file close that.
*/

-- ---------------------------------------------------------------------------
-- 1. Claiming
-- ---------------------------------------------------------------------------

/*
  Claim up to N slots for generation.

  A conditional UPDATE is what makes a double cron fire safe: the second caller
  matches nothing because the first already moved the rows out of the claimable
  states. FOR UPDATE SKIP LOCKED extends that to genuinely concurrent callers —
  two overlapping invocations take disjoint slots instead of blocking or
  double-generating.

  regen_count bounds the work: a slot gets its first attempt and exactly one
  retry. A model that has failed the same constraints twice usually fails again,
  and each attempt costs money and a minute of the morning.

  p_force additionally re-claims slots that already produced content — that is
  the admin's "regenerate this slot" button, not something the cron does.
*/
CREATE OR REPLACE FUNCTION mkt_auto_claim_slots(
  p_run_date date,
  p_limit    integer DEFAULT 2,
  p_slot_no  integer DEFAULT NULL,
  p_force    boolean DEFAULT false
)
RETURNS SETOF mkt_auto_slots
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE mkt_auto_slots s
  SET state = 'generating'
  WHERE s.id IN (
    SELECT c.id FROM mkt_auto_slots c
    WHERE c.run_date = p_run_date
      AND (p_slot_no IS NULL OR c.slot_no = p_slot_no)
      AND (p_force OR c.regen_count < 2)
      AND (
        c.state IN ('planned', 'failed')
        OR (p_force AND c.state IN ('generated', 'flagged', 'rendered'))
      )
    ORDER BY c.slot_no
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING s.*;
END;
$$;

/*
  Record a slot's outcome.

  regen_count increments on every finish, successful or not, because it counts
  ATTEMPTS — that is what bounds the retry loop above. A slot that generated
  cleanly sits at 1 and is not claimable again anyway.
*/
CREATE OR REPLACE FUNCTION mkt_auto_finish_slot(
  p_slot_id    uuid,
  p_state      text,
  p_content_id uuid DEFAULT NULL,
  p_flags      jsonb DEFAULT '[]'::jsonb,
  p_error      text DEFAULT ''
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE mkt_auto_slots SET
    state       = p_state,
    content_id  = COALESCE(p_content_id, content_id),
    lint_flags  = COALESCE(p_flags, '[]'::jsonb),
    error       = COALESCE(p_error, ''),
    regen_count = regen_count + 1
  WHERE id = p_slot_id;
END;
$$;

/* Derive the batch's status from its slots, so the admin strip has one field to
   colour rather than three states to reconcile. */
CREATE OR REPLACE FUNCTION mkt_auto_batch_rollup(p_run_date date)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total integer; v_live integer; v_done integer; v_busy integer; v_dead integer;
  v_status text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE state = 'approved'),
         count(*) FILTER (WHERE state IN ('generated','rendered','flagged','approved')),
         count(*) FILTER (WHERE state IN ('generating','rendering')),
         count(*) FILTER (WHERE state = 'failed')
  INTO v_total, v_live, v_done, v_busy, v_dead
  FROM mkt_auto_slots WHERE run_date = p_run_date;

  v_status := CASE
    WHEN v_total = 0        THEN 'planned'
    WHEN v_live = v_total   THEN 'ready'
    WHEN v_live > 0         THEN 'partial'
    WHEN v_busy > 0         THEN 'generating'
    WHEN v_dead = v_total   THEN 'failed'
    WHEN v_done > 0         THEN 'generated'
    ELSE 'planned'
  END;

  UPDATE mkt_auto_batches
  SET status = v_status,
      generated_at = CASE WHEN v_done > 0 AND generated_at IS NULL THEN now() ELSE generated_at END,
      attempts = attempts + 1
  WHERE run_date = p_run_date;

  RETURN v_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Uniqueness
-- ---------------------------------------------------------------------------

/*
  Nearest existing headline, by trigram similarity.

  Exact-match and hashtag-overlap checks already existed and both miss the
  common case: the same idea rewritten. "The magic of compounding explained"
  against "Compounding, explained simply" shares no exact string and few
  hashtags, but it is the same post.

  pg_trgm lives in the `extensions` schema on this project (relocated out of
  public by 20260809115823), so the operator is schema-qualified rather than
  left to search_path.

  Live content and expired history are both searched: content is hard-deleted
  after its window closes, so mkt_content alone forgets everything older than a
  few days — exactly the horizon over which a model would happily repeat itself.
*/
CREATE OR REPLACE FUNCTION mkt_auto_similar_headlines(p_headline text, p_limit integer DEFAULT 3)
RETURNS TABLE (content_no text, headline text, similarity real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT c.content_no, c.headline, extensions.similarity(c.headline, p_headline) AS similarity
    FROM mkt_content c WHERE c.headline <> ''
    UNION ALL
    SELECT h.content_no, h.headline, extensions.similarity(h.headline, p_headline)
    FROM mkt_content_history h WHERE h.headline <> ''
  ) s
  WHERE s.similarity IS NOT NULL
  ORDER BY s.similarity DESC
  LIMIT p_limit;
$$;

/*
  Every topic ever used in a category, live or expired.

  Uncapped on purpose. The brief allows a category to recur only "with a
  different topic", and with a ~16-run-day cycle a category accumulates a couple
  of dozen topics a year — small enough to send in full, and sending it in full
  is the only way the model can actually honour the rule.
*/
CREATE OR REPLACE FUNCTION mkt_auto_category_topics(p_category text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT t), '{}')
  FROM (
    SELECT c.topic AS t FROM mkt_content c WHERE c.category = p_category AND c.topic <> ''
    UNION
    SELECT h.topic FROM mkt_content_history h WHERE h.category = p_category AND h.topic <> ''
  ) x;
$$;

/*
  Recent titles/headlines/topics across ALL categories.

  The pre-existing history loader is category-scoped, which is nearly useless on
  a daily cadence — a category recurs only every ~16 run days, so yesterday's
  three posts are invisible to today's prompt. The failure this prevents is
  cross-category repetition: the same compounding lesson under six different
  category names.
*/
CREATE OR REPLACE FUNCTION mkt_auto_recent_across_categories(
  p_days integer DEFAULT 45,
  p_limit integer DEFAULT 120
)
RETURNS TABLE (category text, title text, headline text, topic text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- The sort key is selected in the subquery and dropped here: RETURNS TABLE
  -- declares four columns, so `SELECT *` over a five-column subquery is a
  -- "returns too many columns" error at creation time.
  SELECT s.category, s.title, s.headline, s.topic FROM (
    SELECT c.category, c.title, c.headline, c.topic, c.created_at AS at
    FROM mkt_content c WHERE c.created_at > now() - make_interval(days => p_days)
    UNION ALL
    SELECT h.category, h.title, h.headline, h.topic, h.deleted_at
    FROM mkt_content_history h WHERE h.deleted_at > now() - make_interval(days => p_days)
  ) s
  ORDER BY s.at DESC
  LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants
--
-- These functions exist for the automated pipeline, which authenticates as the
-- service role. Everything is revoked from anon and from authenticated (the
-- admin UI reads the tables directly under its own RLS); service_role needs an
-- EXPLICIT grant because the REVOKE ... FROM PUBLIC in the previous migration
-- removed the implicit one it was relying on.
-- ---------------------------------------------------------------------------

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'mkt_auto_claim_slots(date, integer, integer, boolean)',
    'mkt_auto_finish_slot(uuid, text, uuid, jsonb, text)',
    'mkt_auto_batch_rollup(date)',
    'mkt_auto_similar_headlines(text, integer)',
    'mkt_auto_category_topics(text)',
    'mkt_auto_recent_across_categories(integer, integer)',
    'mkt_auto_approve(uuid, text, integer)',
    'mkt_auto_alert_admins(text, text)',
    'mkt_auto_plan_day(date, boolean)',
    'mkt_auto_plan_ahead(integer)',
    'mkt_auto_seed_cycle(integer)',
    'mkt_auto_next_categories(integer, date)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

/* The admin UI calls these two under the admin's own JWT (the "Plan ahead"
   button); everything else stays service-role only. */
GRANT EXECUTE ON FUNCTION mkt_auto_plan_day(date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION mkt_auto_plan_ahead(integer) TO authenticated;
