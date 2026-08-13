/*
  # Automated daily content — rendering and auto-approval

  Adds the state the render worker needs, and the switch that decides whether a
  clean batch goes live on its own.

  ## Auto-approval ships OFF

  The whole pipeline is built, but mkt_auto_settings.auto_approve defaults to
  false so every batch still lands as a draft an admin must approve. That is
  deliberate: the copy should be watched for a week before it publishes itself.
  Turning it on is one UPDATE, and turning it off again is the same — no
  deploy, no migration, which is what makes it safe to try.
*/

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

/* Single row, enforced by a primary key that can only hold one value. A
   settings table with a WHERE clause everyone forgets is worse than this. */
CREATE TABLE IF NOT EXISTS mkt_auto_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  /* When false the batch is rendered but left as drafts. */
  auto_approve         boolean NOT NULL DEFAULT false,
  /* 72h rather than the manual path's 48h so a Friday batch survives a weekend
     with no 1st/3rd Saturday — at 48h the gallery would be empty from Saturday
     morning until Monday 09:30. */
  approve_window_hours integer NOT NULL DEFAULT 72
    CHECK (approve_window_hours BETWEEN 12 AND 240),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mkt_auto_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE mkt_auto_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mkt_auto_settings_admin_select ON mkt_auto_settings;
CREATE POLICY mkt_auto_settings_admin_select ON mkt_auto_settings
  FOR SELECT TO authenticated USING (nw_current_emp_is_admin());

DROP POLICY IF EXISTS mkt_auto_settings_admin_update ON mkt_auto_settings;
CREATE POLICY mkt_auto_settings_admin_update ON mkt_auto_settings
  FOR UPDATE TO authenticated USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

-- ---------------------------------------------------------------------------
-- 2. Render attempts
-- ---------------------------------------------------------------------------

/* Separate from regen_count, which bounds MODEL calls. A render failure is a
   different kind of problem (a browser crash, a storage blip) and deserves its
   own budget — burning a generation attempt because ffmpeg hiccuped would
   throw away perfectly good copy. */
ALTER TABLE mkt_auto_slots
  ADD COLUMN IF NOT EXISTS render_attempts integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. Claiming for render
-- ---------------------------------------------------------------------------

/*
  Claim slots whose copy exists and whose artwork does not.

  Flagged slots are claimed too. Their copy needs a human, but the artwork is
  needed either way, and rendering it now means the admin's fix is one edit and
  an approve rather than an edit, a render and an approve. finalize() re-derives
  the flag state afterwards, so claiming a flagged slot never launders it clean.
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
      AND c.state IN ('generated', 'flagged')
      AND c.render_attempts < 3
    ORDER BY c.slot_no
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING s.*;
END;
$$;

/*
  Hand a slot back after a failed render.

  Returns it to a claimable state so the next workflow run retries, until the
  attempt budget is spent — at which point it becomes 'failed' and shows red to
  an admin rather than silently retrying forever.
*/
CREATE OR REPLACE FUNCTION mkt_auto_render_failed(p_slot_id uuid, p_error text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state text; v_attempts integer; v_flags jsonb;
BEGIN
  SELECT render_attempts, lint_flags INTO v_attempts, v_flags
  FROM mkt_auto_slots WHERE id = p_slot_id;

  v_state := CASE
    WHEN v_attempts >= 3 THEN 'failed'
    WHEN jsonb_array_length(COALESCE(v_flags, '[]'::jsonb)) > 0 THEN 'flagged'
    ELSE 'generated'
  END;

  UPDATE mkt_auto_slots
  SET state = v_state, error = left(COALESCE(p_error, ''), 500)
  WHERE id = p_slot_id;

  RETURN v_state;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'mkt_auto_claim_render(date, integer)',
    'mkt_auto_render_failed(uuid, text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
