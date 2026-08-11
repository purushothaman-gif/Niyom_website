/*
  # Automated daily content — the rotation engine

  Plans three pieces of content a day, Monday to Friday plus the 1st and 3rd
  Saturday of each month, so that each day's batch is live to employees by
  09:30 IST. This migration is planning ONLY: it decides what to make and never
  calls a model or writes a byte of content. Generation and rendering come next.

  ## What the rotation has to satisfy simultaneously

    - three distinct CATEGORIES a day, cycling the whole 49-item taxonomy before
      any category recurs (~16 run days, so ~3.3 weeks);
    - three distinct CONTENT TYPES a day, with all nine covered inside a week;
    - exactly one VIDEO type a day;
    - one item per PLATFORM — Instagram, Facebook, LinkedIn — respecting the
      types that only make sense on one of them;
    - no repeated visual STYLE.

  Those are enforced as database constraints on mkt_auto_slots rather than as
  code conventions. A rotation bug becomes an insert failure at 07:50 IST, not
  three near-identical posts on a client's feed.

  ## Why the planner is SQL and not an edge function

  It makes no external calls. pg_cron invokes it directly, so there is no HTTP
  endpoint to secure, no JWT to arrange, no function to redeploy, and no way for
  it to be triggered by anything outside the database.

  ## The taxonomy is duplicated here, and that is checked

  CONTENT_CATEGORIES and CONTENT_TYPES live in
  src/crm/marketing/marketingConstants.ts. The planner needs them in SQL, and
  the frontend and the database cannot import from each other. The copy below is
  therefore kept honest by src/crm/marketing/autoTaxonomy.test.ts, which parses
  both this file and the constants file and fails if they diverge — so adding a
  category is a two-line change that cannot be half-done.
*/

-- ---------------------------------------------------------------------------
-- 1. Taxonomy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mkt_auto_categories (
  category   text PRIMARY KEY,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mkt_auto_categories (category) VALUES
  ('Personal Finance'), ('Money Management'), ('Financial Literacy'), ('Savings'),
  ('Budgeting'), ('Investment Basics'), ('Mutual Fund Concepts'),
  ('Stock Market Education'), ('Investor Psychology'), ('Financial Planning'),
  ('Goal Based Investing'), ('Emergency Fund'), ('Retirement Planning'),
  ('Children Education Planning'), ('Power of Compounding'), ('Inflation'),
  ('Risk vs Return'), ('Asset Allocation'), ('Diversification'), ('Wealth Building'),
  ('Money Habits'), ('Behavioural Finance'), ('Tax Awareness'), ('Financial Myths'),
  ('Financial Mistakes'), ('Economic Awareness'), ('Market Awareness'),
  ('Investment Terminologies'), ('Investment Journey'), ('Financial Independence'),
  ('Long Term Investing'), ('SIP Concepts'), ('Passive Income Education'),
  ('Business Finance Basics'), ('Family Financial Planning'), ('Insurance Awareness'),
  ('Market History'), ('Interesting Financial Facts'), ('Comparison Infographics'),
  ('Weekly Finance Facts'), ('Finance Quiz'), ('Did You Know'), ('Finance Quotes'),
  ('Investor Awareness'), ('Financial Checklists'), ('Budget Templates'),
  ('Money Challenges'), ('Finance FAQs'), ('Beginner Finance Guides')
ON CONFLICT (category) DO NOTHING;

/*
  `hard_platform` is set for the three types whose geometry only works on one
  network: an Instagram Story is 9:16, a Facebook Post and a LinkedIn Post carry
  those networks' names and ratios. Because those three pin to three DIFFERENT
  platforms, a perfect one-per-platform matching always exists no matter which
  types a day draws.

  `soft_platform` is a preference, not a constraint: short_video is the only
  9:16 video and so belongs on Reels when Instagram is still free.
*/
CREATE TABLE IF NOT EXISTS mkt_auto_content_types (
  content_type  text PRIMARY KEY,
  is_video      boolean NOT NULL,
  is_deck       boolean NOT NULL,
  hard_platform text,
  soft_platform text,
  CONSTRAINT mkt_auto_ct_platform_check CHECK (
    (hard_platform IS NULL OR hard_platform IN ('instagram','facebook','linkedin')) AND
    (soft_platform IS NULL OR soft_platform IN ('instagram','facebook','linkedin'))
  )
);

INSERT INTO mkt_auto_content_types (content_type, is_video, is_deck, hard_platform, soft_platform) VALUES
  ('poster',          false, false, NULL,       NULL),
  ('carousel',        false, true,  NULL,       NULL),
  ('story',           false, false, 'instagram', NULL),
  ('facebook_post',   false, false, 'facebook',  NULL),
  ('linkedin_post',   false, false, 'linkedin',  NULL),
  ('infographic',     false, true,  NULL,       'linkedin'),
  ('animated_poster', true,  false, NULL,       'facebook'),
  ('motion_graphic',  true,  false, NULL,       'linkedin'),
  ('short_video',     true,  false, NULL,       'instagram')
ON CONFLICT (content_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Rotation state
-- ---------------------------------------------------------------------------

/* There is no holiday calendar anywhere in this project, and Diwali will come
   up. This is the escape hatch: an admin blocks a date and the planner skips it
   without any code change. */
CREATE TABLE IF NOT EXISTS mkt_auto_skip_days (
  run_date   date PRIMARY KEY,
  reason     text NOT NULL DEFAULT '',
  created_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

/* One row per category per cycle. A category is consumed once per cycle, so it
   physically cannot recur until the full 49 have been used. */
CREATE TABLE IF NOT EXISTS mkt_auto_category_cycle (
  cycle_no    integer NOT NULL,
  position    integer NOT NULL,
  category    text    NOT NULL REFERENCES mkt_auto_categories(category) ON DELETE CASCADE,
  consumed_at timestamptz,
  run_date    date,
  PRIMARY KEY (cycle_no, category),
  UNIQUE (cycle_no, position)
);

CREATE INDEX IF NOT EXISTS idx_mkt_auto_cycle_unconsumed
  ON mkt_auto_category_cycle (cycle_no, position) WHERE consumed_at IS NULL;

/*
  Least-recently-used ledger for visual style.

  4 templates x 11 palettes = 44 combinations, and only 2 templates support
  slides, so decks draw from 22. With ~860 items a year a pair recurs roughly
  every 15 run days. "Never the same style" therefore means LRU rotation — with
  a finite combination set, global uniqueness is not achievable and pretending
  otherwise would just hide the recurrence.

  Video slots use the sentinel template_id 'video': VideoRenderer takes only a
  palette, so they rotate through their own 11-entry lane rather than polluting
  the poster lanes.
*/
CREATE TABLE IF NOT EXISTS mkt_auto_style_ledger (
  template_id  text NOT NULL,
  palette_id   text NOT NULL,
  last_used_on date,
  use_count    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, palette_id)
);

-- ---------------------------------------------------------------------------
-- 3. The plan
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mkt_auto_batches (
  run_date     date PRIMARY KEY,
  iso_week     text NOT NULL,
  status       text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','generating','generated','rendering','ready','partial','failed')),
  planned_at   timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz,
  rendered_at  timestamptz,
  /* 09:30 IST of run_date, stored in UTC. Content is written with this as its
     scheduled_publish_at, so the existing RLS predicate — not any new code — is
     what keeps a batch invisible until the gate opens. */
  publish_at   timestamptz NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  error        text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mkt_auto_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date      date NOT NULL REFERENCES mkt_auto_batches(run_date) ON DELETE CASCADE,
  slot_no       integer NOT NULL CHECK (slot_no BETWEEN 1 AND 3),
  content_type  text NOT NULL REFERENCES mkt_auto_content_types(content_type),
  platform      text NOT NULL CHECK (platform IN ('instagram','facebook','linkedin')),
  category      text NOT NULL,
  cycle_no      integer NOT NULL,
  template_id   text NOT NULL DEFAULT '',
  palette_id    text NOT NULL DEFAULT '',
  slide_count            integer,
  video_duration_seconds integer,
  content_id    uuid REFERENCES mkt_content(id) ON DELETE SET NULL,
  state         text NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned','generating','generated','rendering','rendered','approved','flagged','failed')),
  lint_flags    jsonb NOT NULL DEFAULT '[]'::jsonb,
  regen_count   integer NOT NULL DEFAULT 0,
  error         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  /* The day's invariants, as constraints. A rotation bug fails an insert at
     07:50 rather than shipping three lookalike posts. */
  UNIQUE (run_date, slot_no),
  UNIQUE (run_date, platform),
  UNIQUE (run_date, content_type),
  UNIQUE (run_date, category)
);

CREATE INDEX IF NOT EXISTS idx_mkt_auto_slots_state ON mkt_auto_slots (state, run_date);
CREATE INDEX IF NOT EXISTS idx_mkt_auto_slots_content ON mkt_auto_slots (content_id);

CREATE OR REPLACE FUNCTION mkt_auto_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION mkt_auto_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mkt_auto_slots_updated_at ON mkt_auto_slots;
CREATE TRIGGER trg_mkt_auto_slots_updated_at
  BEFORE UPDATE ON mkt_auto_slots
  FOR EACH ROW EXECUTE FUNCTION mkt_auto_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Run-day predicate
-- ---------------------------------------------------------------------------

/*
  Monday to Friday, plus the 1st and 3rd Saturday.

  (day - 1) / 7 integer-divides to the ordinal occurrence of that weekday in the
  month: days 1-7 give 0 (first), 8-14 give 1, 15-21 give 2 (third). So IN (0,2)
  is exactly "the 1st and 3rd Saturday", with no calendar arithmetic to get
  wrong at a month boundary.

  IMMUTABLE and holiday-free on purpose — skip days are a separate table so this
  stays a pure function of the date and can be indexed and unit-tested.
*/
CREATE OR REPLACE FUNCTION mkt_auto_is_run_day(p_day date)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE extract(isodow FROM p_day)::int
    WHEN 7 THEN false
    WHEN 6 THEN ((extract(day FROM p_day)::int - 1) / 7) IN (0, 2)
    ELSE true
  END;
$$;

COMMENT ON FUNCTION mkt_auto_is_run_day(date) IS
  'True on Mon-Fri and on the 1st and 3rd Saturday. Holidays live in mkt_auto_skip_days.';

-- ---------------------------------------------------------------------------
-- 5. Category cycle
-- ---------------------------------------------------------------------------

/*
  Seed a cycle. md5(cycle_no || category) is a stable permutation — no setseed(),
  which is session-global and behaves badly inside a function called by cron.

  ## The cycle seam, which a naive reshuffle gets wrong

  "A category may only repeat once the circle completes" is satisfied by any
  per-cycle permutation — but satisfying it on paper is not the point. A full
  reshuffle lets a category sit near the END of cycle N and near the START of
  cycle N+1, so it recurs a few days later while the rule is formally honoured.
  That is not a hypothetical: the first implementation here put "Long Term
  Investing" six days apart across the seam.

  Guarding only the last three positions does not fix it, because the tail of a
  cycle is consumed over several days, three at a time.

  So the new cycle preserves the old cycle's COARSE recency order and shuffles
  only WITHIN blocks. A category from the old cycle's first block lands in the
  new cycle's first block, and so on.

  The guarantee that buys, for n categories in blocks of b: the worst case is a
  category at the end of a block landing at the start of that same block, giving
  a gap of (n - block_end) + block_start = n + 1 - b slots. With n = 49 and
  b = 13 that is 37 slots — over 12 run days, every time, provably. Variety is
  preserved because each block of 13 still shuffles freely.

  Categories added to the taxonomy later have no previous position and sort
  first: never used is the strongest claim to a slot.
*/
CREATE OR REPLACE FUNCTION mkt_auto_seed_cycle(p_cycle_no integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_block integer;
BEGIN
  IF EXISTS (SELECT 1 FROM mkt_auto_category_cycle WHERE cycle_no = p_cycle_no) THEN
    RETURN;
  END IF;

  -- First cycle has no history to preserve: a plain deterministic shuffle.
  IF NOT EXISTS (SELECT 1 FROM mkt_auto_category_cycle WHERE cycle_no = p_cycle_no - 1) THEN
    INSERT INTO mkt_auto_category_cycle (cycle_no, position, category)
    SELECT p_cycle_no,
           row_number() OVER (ORDER BY md5(p_cycle_no::text || c.category)),
           c.category
    FROM mkt_auto_categories c WHERE c.active;
    RETURN;
  END IF;

  SELECT greatest(4, ceil(count(*) / 4.0)::integer) INTO v_block
  FROM mkt_auto_categories WHERE active;

  INSERT INTO mkt_auto_category_cycle (cycle_no, position, category)
  SELECT p_cycle_no,
         row_number() OVER (ORDER BY t.block, md5(p_cycle_no::text || t.category)),
         t.category
  FROM (
    SELECT c.category,
           coalesce((prev.position - 1) / v_block, -1) AS block
    FROM mkt_auto_categories c
    LEFT JOIN mkt_auto_category_cycle prev
      ON prev.category = c.category AND prev.cycle_no = p_cycle_no - 1
    WHERE c.active
  ) t;
END;
$$;
REVOKE ALL ON FUNCTION mkt_auto_seed_cycle(integer) FROM PUBLIC, anon, authenticated;

/* Take the next N unconsumed categories, seeding the following cycle when the
   current one runs out. Returns (cycle_no, category) in cycle order. */
CREATE OR REPLACE FUNCTION mkt_auto_next_categories(p_n integer, p_run_date date)
RETURNS TABLE (cycle_no integer, category text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cycle integer;
BEGIN
  SELECT coalesce(max(c.cycle_no), 0) INTO v_cycle FROM mkt_auto_category_cycle c;
  IF v_cycle = 0 THEN
    PERFORM mkt_auto_seed_cycle(1);
    v_cycle := 1;
  END IF;

  /* A cycle boundary can fall mid-day: two categories left, three needed. Seed
     the next cycle first so the day still gets three and the seam is invisible. */
  IF (SELECT count(*) FROM mkt_auto_category_cycle c
      WHERE c.cycle_no = v_cycle AND c.consumed_at IS NULL) < p_n THEN
    PERFORM mkt_auto_seed_cycle(v_cycle + 1);
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT c.cycle_no, c.category
    FROM mkt_auto_category_cycle c
    WHERE c.consumed_at IS NULL
    ORDER BY c.cycle_no, c.position
    LIMIT p_n
  ), marked AS (
    UPDATE mkt_auto_category_cycle u
    SET consumed_at = now(), run_date = p_run_date
    FROM picked p
    WHERE u.cycle_no = p.cycle_no AND u.category = p.category
    RETURNING u.cycle_no, u.category, u.position
  )
  SELECT m.cycle_no, m.category FROM marked m ORDER BY m.cycle_no, m.position;
END;
$$;
REVOKE ALL ON FUNCTION mkt_auto_next_categories(integer, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The planner
-- ---------------------------------------------------------------------------

/*
  Plan one day.

  Idempotent by construction: the batch insert is ON CONFLICT DO NOTHING and an
  empty return means the day is already planned, so a double cron fire consumes
  no categories and inserts no slots.

  The week's type sequence is derived from the ISO week key, not from a running
  counter, so planning Wednesday and then re-planning Thursday reproduces the
  same week — and a dry run for any future date is exactly what that date will
  get.

  ## Why the whole week is derived at once

  Per-day round-robin does not guarantee "all nine types this week". A type at
  the end of one 6-cycle and the start of the next is 11 image-picks apart,
  which straddles a week boundary. Deriving the week's sequence up front makes
  weekly coverage a construction invariant instead of an emergent hope: the
  first six image picks are a permutation of all six image types, so every image
  type has appeared by day three, and the three video types cycle across the
  five-or-six video slots.
*/
CREATE OR REPLACE FUNCTION mkt_auto_plan_day(p_run_date date, p_force boolean DEFAULT false)
RETURNS SETOF mkt_auto_slots
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_week      text;
  v_monday    date;
  v_index     integer;
  v_video     text[];
  v_images    text[];
  v_types     text[];
  v_cats      text[];
  v_cycles    integer[];
  v_platforms text[] := ARRAY[NULL, NULL, NULL]::text[];
  v_free      text[];
  v_hard      text;
  v_soft      text;
  v_i         integer;
  v_type      text;
  v_template  text;
  v_palette   text;
  v_is_video  boolean;
  v_is_deck   boolean;
  v_used      text[] := '{}';
  v_used_tpl  text[] := '{}';
BEGIN
  IF NOT mkt_auto_is_run_day(p_run_date) AND NOT p_force THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM mkt_auto_skip_days s WHERE s.run_date = p_run_date) AND NOT p_force THEN
    RETURN;
  END IF;

  v_week   := to_char(p_run_date, 'IYYY-IW');
  v_monday := (date_trunc('week', p_run_date::timestamp))::date;

  INSERT INTO mkt_auto_batches (run_date, iso_week, publish_at)
  VALUES (
    p_run_date, v_week,
    (p_run_date::timestamp + interval '9 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata'
  )
  ON CONFLICT (run_date) DO NOTHING;

  IF EXISTS (SELECT 1 FROM mkt_auto_slots s WHERE s.run_date = p_run_date) THEN
    RETURN QUERY SELECT * FROM mkt_auto_slots s WHERE s.run_date = p_run_date ORDER BY s.slot_no;
    RETURN;
  END IF;

  -- Which run day of the week is this? greatest(...,1) covers a forced plan on
  -- a day the predicate excludes, which would otherwise index the array at 0.
  SELECT greatest(count(*), 1) INTO v_index
  FROM generate_series(v_monday, p_run_date, interval '1 day') AS g(d)
  WHERE mkt_auto_is_run_day(g.d::date)
    AND NOT EXISTS (SELECT 1 FROM mkt_auto_skip_days s WHERE s.run_date = g.d::date);

  -- Video lane: a stable permutation of the three video types, cycled.
  SELECT array_agg(t.content_type ORDER BY md5(v_week || ':v:' || t.content_type))
  INTO v_video
  FROM mkt_auto_content_types t WHERE t.is_video;

  -- Image lane: two stable permutations end to end. Slots take positions
  -- (2i-1, 2i), which never straddle the join, so the pair is always distinct
  -- and the first six picks cover all six image types.
  SELECT (
    (SELECT array_agg(t.content_type ORDER BY md5(v_week || ':i1:' || t.content_type))
       FROM mkt_auto_content_types t WHERE NOT t.is_video) ||
    (SELECT array_agg(t.content_type ORDER BY md5(v_week || ':i2:' || t.content_type))
       FROM mkt_auto_content_types t WHERE NOT t.is_video)
  ) INTO v_images;

  v_types := ARRAY[
    v_video[((v_index - 1) % array_length(v_video, 1)) + 1],
    v_images[2 * v_index - 1],
    v_images[2 * v_index]
  ];

  /*
    Platforms: pin the hard-affinity types, honour soft preferences where the
    platform is still free, then fill deterministically.

    Every membership test goes through array_remove(v_platforms, NULL). The
    array starts as three NULLs, and `x = ANY (ARRAY[NULL,NULL,NULL])` is NULL
    rather than false in SQL's three-valued logic — so `NOT (x = ANY ...)` is
    also NULL, and the IF silently never fires. Stripping the NULLs first is
    what makes these tests mean what they read as.
  */
  FOR v_i IN 1..3 LOOP
    SELECT t.hard_platform INTO v_hard FROM mkt_auto_content_types t WHERE t.content_type = v_types[v_i];
    IF v_hard IS NOT NULL AND NOT (v_hard = ANY (array_remove(v_platforms, NULL))) THEN
      v_platforms[v_i] := v_hard;
    END IF;
  END LOOP;

  FOR v_i IN 1..3 LOOP
    CONTINUE WHEN v_platforms[v_i] IS NOT NULL;
    SELECT t.soft_platform INTO v_soft FROM mkt_auto_content_types t WHERE t.content_type = v_types[v_i];
    IF v_soft IS NOT NULL AND NOT (v_soft = ANY (array_remove(v_platforms, NULL))) THEN
      v_platforms[v_i] := v_soft;
    END IF;
  END LOOP;

  SELECT array_agg(u.p ORDER BY md5(v_week || v_index::text || u.p)) INTO v_free
  FROM unnest(ARRAY['instagram','facebook','linkedin']) AS u(p)
  WHERE NOT (u.p = ANY (array_remove(v_platforms, NULL)));

  FOR v_i IN 1..3 LOOP
    IF v_platforms[v_i] IS NULL THEN
      v_platforms[v_i] := v_free[1];
      v_free := v_free[2:];
    END IF;
  END LOOP;

  -- Categories.
  SELECT array_agg(c.category ORDER BY ord), array_agg(c.cycle_no ORDER BY ord)
  INTO v_cats, v_cycles
  FROM (SELECT n.cycle_no, n.category, row_number() OVER () AS ord
        FROM mkt_auto_next_categories(3, p_run_date) n) c;

  IF v_cats IS NULL OR array_length(v_cats, 1) < 3 THEN
    RAISE EXCEPTION 'mkt_auto_plan_day: category cycle produced % of 3 for %',
      coalesce(array_length(v_cats, 1), 0), p_run_date;
  END IF;

  -- Slots.
  FOR v_i IN 1..3 LOOP
    v_type := v_types[v_i];
    SELECT t.is_video, t.is_deck INTO v_is_video, v_is_deck
    FROM mkt_auto_content_types t WHERE t.content_type = v_type;

    /*
      Style: least-recently-used among the templates this type can actually use.

      Three avoidances, and the distinctions matter.

      Palette already taken by a sibling slot TODAY: hard filter. Three posts in
      one batch must not share a colourway.

      Template already taken by a sibling slot today: also a hard filter, but
      only among the two non-video slots — the video lane uses the sentinel
      'video' and would otherwise be excluded by its own siblings. Without this
      a day could draw `checklist` twice and ship two structurally identical
      posters in different colours, which is precisely the "same style" the
      brief rules out. Always satisfiable: two image slots against four
      templates, or against two when both happen to be decks.

      Yesterday's palettes: only a sort penalty. With 11 palettes, up to 2 taken
      today and 3 taken yesterday, a hard filter on both could empty the
      candidate set for the single-template video lane and leave palette_id
      blank. A preference degrades; a filter fails.

      NULLS FIRST so a never-used combination always beats a used one.
    */
    SELECT g.template_id, g.palette_id INTO v_template, v_palette
    FROM (
      SELECT t.id AS template_id, p.id AS palette_id
      FROM (
        SELECT unnest(
          CASE
            WHEN v_is_video THEN ARRAY['video']
            WHEN v_is_deck  THEN ARRAY['bold_statement','checklist']
            ELSE ARRAY['bold_statement','stat_highlight','editorial_quote','checklist']
          END) AS id
      ) t
      CROSS JOIN (
        SELECT unnest(ARRAY['midnightGold','porcelainInk','creamGold','goldOnNavyBold',
                            'tealDeep','plumRich','forestCalm','sunsetWarm',
                            'indigoNight','sandWarm','slateMint']) AS id
      ) p
      WHERE NOT (p.id = ANY (v_used))
        AND (v_is_video OR NOT (t.id = ANY (v_used_tpl)))
    ) g
    LEFT JOIN mkt_auto_style_ledger l
      ON l.template_id = g.template_id AND l.palette_id = g.palette_id
    ORDER BY EXISTS (
               SELECT 1 FROM mkt_auto_slots s
               WHERE s.palette_id = g.palette_id
                 AND s.run_date = (
                   SELECT max(b.run_date) FROM mkt_auto_batches b WHERE b.run_date < p_run_date
                 )
             ) ASC,
             l.last_used_on ASC NULLS FIRST,
             coalesce(l.use_count, 0) ASC,
             md5(v_week || p_run_date::text || v_i::text || g.template_id || g.palette_id)
    LIMIT 1;

    v_used := v_used || v_palette;
    IF NOT v_is_video THEN v_used_tpl := v_used_tpl || v_template; END IF;

    INSERT INTO mkt_auto_style_ledger (template_id, palette_id, last_used_on, use_count)
    VALUES (v_template, v_palette, p_run_date, 1)
    ON CONFLICT (template_id, palette_id)
    DO UPDATE SET last_used_on = EXCLUDED.last_used_on,
                  use_count = mkt_auto_style_ledger.use_count + 1;

    INSERT INTO mkt_auto_slots (
      run_date, slot_no, content_type, platform, category, cycle_no,
      template_id, palette_id, slide_count, video_duration_seconds
    ) VALUES (
      p_run_date, v_i, v_type, v_platforms[v_i], v_cats[v_i], v_cycles[v_i],
      CASE WHEN v_is_video THEN '' ELSE v_template END,
      v_palette,
      CASE WHEN v_is_deck THEN 5 ELSE NULL END,
      CASE WHEN v_is_video THEN 30 ELSE NULL END
    );
  END LOOP;

  RETURN QUERY SELECT * FROM mkt_auto_slots s WHERE s.run_date = p_run_date ORDER BY s.slot_no;
END;
$$;
REVOKE ALL ON FUNCTION mkt_auto_plan_day(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mkt_auto_plan_day(date, boolean) TO authenticated;

/* Plan the next N run days in one call — what the admin surface previews and
   what the nightly cron uses to stay a few days ahead. */
CREATE OR REPLACE FUNCTION mkt_auto_plan_ahead(p_days integer DEFAULT 14)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d date; v_n integer := 0;
BEGIN
  FOR v_d IN
    SELECT g.d::date FROM generate_series(
      (now() AT TIME ZONE 'Asia/Kolkata')::date,
      (now() AT TIME ZONE 'Asia/Kolkata')::date + p_days, interval '1 day') AS g(d)
  LOOP
    IF mkt_auto_is_run_day(v_d)
       AND NOT EXISTS (SELECT 1 FROM mkt_auto_skip_days s WHERE s.run_date = v_d)
       AND NOT EXISTS (SELECT 1 FROM mkt_auto_batches b WHERE b.run_date = v_d) THEN
      PERFORM mkt_auto_plan_day(v_d);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION mkt_auto_plan_ahead(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mkt_auto_plan_ahead(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Auto-approval and alerts
-- ---------------------------------------------------------------------------

/*
  The automated path's approval.

  mkt_set_content_status() cannot be used: it opens with nw_current_emp_is_admin(),
  which reads auth.uid() and is NULL under the service role. Relaxing that guard
  was considered and rejected — it is the single approval choke point for every
  caller, forever, and widening it for one automated case is exactly how such a
  guard stops meaning anything.

  So this is a sibling with the opposite restriction: service role only, admins
  keep using mkt_set_content_status(). It derives expires_at from the same
  server-clock expression and writes the same approval event, so an auto-approved
  row is indistinguishable downstream.

  ## Why 72 hours here and 48 hours there

  Manual content is published when someone chooses to publish it. Automated
  content arrives on a fixed Mon-Fri plus 1st/3rd-Saturday cadence, and at 48
  hours the gallery goes EMPTY from Saturday morning until Monday 09:30 on the
  weekends without a Saturday batch. 72 hours bridges that gap. The window is a
  parameter rather than a constant so a future cadence change does not need a
  migration.
*/
CREATE OR REPLACE FUNCTION mkt_auto_approve(
  p_content_id uuid,
  p_note text DEFAULT '',
  p_hours integer DEFAULT 72
)
RETURNS mkt_content
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row mkt_content;
BEGIN
  IF coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'mkt_auto_approve is reserved for the automated pipeline';
  END IF;

  UPDATE mkt_content SET
    status      = 'approved',
    approved_by = NULL,
    approved_at = now(),
    expires_at  = greatest(now(), COALESCE(scheduled_publish_at, now())) + make_interval(hours => p_hours)
  WHERE id = p_content_id AND status = 'draft'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Content not found or not in draft: %', p_content_id;
  END IF;

  INSERT INTO mkt_approval_events (content_id, content_no, action, actor_employee_id, note)
  VALUES (v_row.id, v_row.content_no, 'approved', NULL,
          COALESCE(NULLIF(p_note, ''), 'auto-approved: lint clean'));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION mkt_auto_approve(uuid, text, integer) FROM PUBLIC, anon, authenticated;

/* Fan a batch problem out to every active admin, in the place they already
   look. GitHub emailing a failed workflow is not enough — the people who need
   to act on a flagged post live in the CRM. */
CREATE OR REPLACE FUNCTION mkt_auto_alert_admins(p_title text, p_message text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO nw_alerts (employee_id, title, message, category, action_url)
  SELECT e.id, p_title, p_message, 'marketing', '/crm/marketing_content'
  FROM nw_employees e
  WHERE e.role IN ('admin','super_admin') AND e.status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION mkt_auto_alert_admins(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS — admins read, nobody writes from a client
-- ---------------------------------------------------------------------------

ALTER TABLE mkt_auto_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_auto_content_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_auto_skip_days     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_auto_category_cycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_auto_style_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_auto_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_auto_slots         ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_auto_categories','mkt_auto_content_types','mkt_auto_skip_days',
                           'mkt_auto_category_cycle','mkt_auto_style_ledger',
                           'mkt_auto_batches','mkt_auto_slots']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (nw_current_emp_is_admin())',
      t || '_admin_select', t);
  END LOOP;
END $$;

/* Skip days are the one thing an admin sets by hand. Everything else is written
   by the service role, which bypasses RLS — no client-write policy exists, for
   the same reason mkt_content has no delete policy. */
DROP POLICY IF EXISTS mkt_auto_skip_days_admin_write ON mkt_auto_skip_days;
CREATE POLICY mkt_auto_skip_days_admin_write ON mkt_auto_skip_days
  FOR INSERT TO authenticated WITH CHECK (nw_current_emp_is_admin());

DROP POLICY IF EXISTS mkt_auto_skip_days_admin_delete ON mkt_auto_skip_days;
CREATE POLICY mkt_auto_skip_days_admin_delete ON mkt_auto_skip_days
  FOR DELETE TO authenticated USING (nw_current_emp_is_admin());

-- ---------------------------------------------------------------------------
-- 9. Schedule the planner
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

/*
  02:20 UTC = 07:50 IST, ten minutes ahead of the generation window.

  No net.http_post and no URL: this is pure SQL, so pg_cron calls it directly.
  (The app.settings.* GUCs other jobs once relied on are not configured on this
  instance and silently post to a null URL — irrelevant here, and worth keeping
  irrelevant.)

  It plans two weeks ahead rather than only today, so the admin surface can show
  the upcoming rotation and a planning bug is visible days before it ships.
*/
SELECT cron.unschedule('mkt-auto-plan')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mkt-auto-plan');

SELECT cron.schedule('mkt-auto-plan', '20 2 * * *', $$SELECT mkt_auto_plan_ahead(14)$$);
