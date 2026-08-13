/*
  # Automated daily content — reconcile slots whose content is gone

  ## The gap

  mkt_auto_slots.content_id is ON DELETE SET NULL, and content is HARD deleted
  once its window closes (mkt-expire-content removes the row, the storage
  objects and all). So the normal, expected end of a successful piece leaves its
  slot pointing at nothing.

  That was fine while the slot was already terminal. It is not fine in the
  window between generation and render: mkt_auto_claim_render requires
  content_id IS NOT NULL, so a slot orphaned while still 'generated' can never
  be claimed, never errors, and sits in a non-terminal state forever — invisible
  in the Auto Schedule strip, which colours it as work still to come.

  Observed on 2026-08-11 slot 1: MKT-00021 was approved, lived its 48 hours,
  and was swept away on the 13th. Its slot stayed 'generated' with a null
  content_id and no error, permanently unclaimable.

  ## The fix

  Reconcile inside mkt_auto_batch_rollup, which already runs after every
  generation and every finalize. Any slot with no content lands in a terminal
  state with a reason, so it self-heals without a new schedule or a trigger on
  the deletion path (which must stay exactly as it is — see the note in
  marketingClient.ts about never bypassing mkt-expire-content).

  'failed' rather than a new 'deleted' state: the UI already renders failed
  distinctly, and the error text carries the actual explanation. Adding an enum
  value would mean touching the CHECK constraint, the TypeScript union and every
  switch that maps state to a colour, for a case an admin reads once.
*/

CREATE OR REPLACE FUNCTION mkt_auto_batch_rollup(p_run_date date)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total integer; v_live integer; v_done integer; v_busy integer; v_dead integer;
  v_status text;
BEGIN
  /*
    Slots whose content no longer exists. Distinguishing the two reasons matters
    to whoever reads it: a piece that ran its full course and expired is the
    system working, while one deleted before it ever went live is not.
  */
  UPDATE mkt_auto_slots s
  SET state = 'failed',
      error = CASE
        WHEN EXISTS (
          SELECT 1 FROM mkt_content_history h
          WHERE h.content_no = (
            SELECT e.content_no FROM mkt_approval_events e
            WHERE e.content_id IS NULL AND e.created_at >= s.created_at
            ORDER BY e.created_at LIMIT 1
          )
        ) THEN 'content expired and was swept before this slot was rendered'
        ELSE 'content row was deleted before this slot was rendered'
      END
  WHERE s.run_date = p_run_date
    AND s.content_id IS NULL
    AND s.state IN ('generated', 'flagged', 'rendering', 'rendered');

  /*
    Slots whose content an ADMIN approved.

    mkt_content.status is the only thing that decides what employees see, so a
    slot reading 'rendered' while its content is live makes the Auto Schedule
    strip — the one screen built to be scannable — lie in the direction that
    matters: amber "still needs work" for a day that is already published. That
    happens on every manual approval, and it happened to the whole 13 Aug batch.
  */
  UPDATE mkt_auto_slots s
  SET state = 'approved'
  FROM mkt_content c
  WHERE c.id = s.content_id
    AND s.run_date = p_run_date
    AND c.status = 'approved'
    AND s.state IN ('generated', 'rendered', 'flagged');

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

REVOKE ALL ON FUNCTION mkt_auto_batch_rollup(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mkt_auto_batch_rollup(date) TO service_role;

/* Reconcile everything already planned, which clears the observed 11 Aug slot
   and refreshes each batch's status against the states the render backfill
   left behind. */
DO $$
DECLARE d date;
BEGIN
  FOR d IN SELECT run_date FROM mkt_auto_batches ORDER BY run_date LOOP
    PERFORM mkt_auto_batch_rollup(d);
  END LOOP;
END $$;
