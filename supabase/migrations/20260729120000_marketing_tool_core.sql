/*
  # Marketing Tool — Content Creation core schema

  Backs the new CRM module at /crm/marketing_content. Admins generate
  education-only finance content (poster / carousel / story / platform posts /
  animated poster / short video / motion graphic / infographic); employees see
  ONLY approved, unexpired content and download it to post on their own social
  accounts.

  ## Lifecycle
      draft --(admin approve)--> approved --(48h after it becomes visible)--> HARD DELETED
            \-(reject)-> rejected      \-(archive)-> archived

  Approval sets expires_at = greatest(now, scheduled_publish_at) + 48h, always on
  the SERVER clock via mkt_set_content_status() — never from the client.

  ## Hard delete vs. analytics (deliberate interpretation)
  The requirement is that approved content disappears completely 48h after
  approval — DB rows, storage objects, download links — with no backups. The same
  requirement also asks for lifetime analytics ("total generated / approved /
  deleted", "most downloaded") and de-duplication against past content. Those are
  contradictory if literally everything is erased.

  Resolution: the CONTENT is hard-deleted (body, caption, CTA, SEO keywords,
  design spec, and every storage asset — irrecoverable, no archive). A slim
  metadata row survives in mkt_content_history (topic, type, platforms, title,
  headline, hashtags, counters, dates). That row is what the spec calls "Content
  History", and it is what makes both the uniqueness check and the analytics
  dashboard possible after expiry. It contains nothing publishable.

  ## Access model
  - Admin / super_admin: full read + write. NO delete policy anywhere on purpose
    (see below).
  - Employee: SELECT on mkt_content only while status='approved', not expired and
    past its scheduled publish time; INSERT of their own mkt_downloads rows.
  - Deletes are intentionally NOT grantable from the client. All deletion runs
    through the mkt-expire-content edge function (service role) so storage
    cleanup, the history row and the deletion log can never be skipped.

  ## Safety
  Idempotent and additive: CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS before
  CREATE POLICY, CREATE OR REPLACE FUNCTION. No existing table is altered and no
  existing row is touched.
*/

-- ---------------------------------------------------------------------------
-- 1. Human-readable content reference (MKT-00001, MKT-00002, ...)
--    Denormalised onto the audit/event tables so they stay meaningful after the
--    content row itself is hard-deleted.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS mkt_content_no_seq;

CREATE OR REPLACE FUNCTION mkt_next_content_no()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'MKT-' || lpad(nextval('mkt_content_no_seq')::text, 5, '0');
$$;

-- ---------------------------------------------------------------------------
-- 2. Content
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mkt_content (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_no           text UNIQUE NOT NULL DEFAULT mkt_next_content_no(),

  -- What it is
  content_type         text NOT NULL,
  platforms            text[] NOT NULL DEFAULT '{}',
  category             text NOT NULL DEFAULT '',
  topic                text NOT NULL DEFAULT '',

  -- Generated copy
  title                text NOT NULL DEFAULT '',
  headline             text NOT NULL DEFAULT '',
  body                 text NOT NULL DEFAULT '',
  -- Caption carries the literal {{REF_LINK}} placeholder; it is replaced with
  -- the *reading* employee's personal referral URL at copy time, client-side.
  caption              text NOT NULL DEFAULT '',
  hashtags             text[] NOT NULL DEFAULT '{}',
  cta                  text NOT NULL DEFAULT '',
  seo_keywords         text[] NOT NULL DEFAULT '{}',
  suggested_post_time  text NOT NULL DEFAULT '',
  platform_notes       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Design / rendering
  template_id          text NOT NULL DEFAULT '',
  design_spec          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance (model, token usage, lint result) — audit only
  generation_meta      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Workflow
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','approved','rejected','archived')),
  created_by           uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  approved_by          uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  approved_at          timestamptz,
  scheduled_publish_at timestamptz,
  expires_at           timestamptz,
  reject_reason        text NOT NULL DEFAULT '',

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_content_status_expires ON mkt_content (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_mkt_content_category       ON mkt_content (category);
CREATE INDEX IF NOT EXISTS idx_mkt_content_created_at     ON mkt_content (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_content_created_by     ON mkt_content (created_by);
CREATE INDEX IF NOT EXISTS idx_mkt_content_approved_by    ON mkt_content (approved_by);

CREATE OR REPLACE FUNCTION mkt_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mkt_content_updated_at ON mkt_content;
CREATE TRIGGER trg_mkt_content_updated_at
  BEFORE UPDATE ON mkt_content
  FOR EACH ROW EXECUTE FUNCTION mkt_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Rendered assets (PNG per aspect ratio, carousel slides, video)
--    CASCADE: when content is hard-deleted the asset rows go with it. The
--    storage objects themselves are removed by the edge function BEFORE the row
--    delete, so a failure there leaves the row intact for the next sweep.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mkt_content_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id       uuid NOT NULL REFERENCES mkt_content(id) ON DELETE CASCADE,
  -- square | portrait | story | landscape | carousel_01..carousel_NN | video
  variant          text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('image','video')),
  storage_path     text NOT NULL,
  width            integer,
  height           integer,
  duration_seconds integer,
  file_size        bigint,
  mime_type        text NOT NULL DEFAULT 'image/png',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, variant)
);

CREATE INDEX IF NOT EXISTS idx_mkt_assets_content ON mkt_content_assets (content_id);

-- ---------------------------------------------------------------------------
-- 4. Approval / audit trail. Survives content deletion (FK nulls out, the
--    denormalised content_no keeps the row readable).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mkt_approval_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id         uuid REFERENCES mkt_content(id) ON DELETE SET NULL,
  content_no         text NOT NULL,
  action             text NOT NULL CHECK (action IN
                       ('generated','edited','approved','rejected','archived','deleted','expired')),
  actor_employee_id  uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  note               text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_events_content_no ON mkt_approval_events (content_no);
CREATE INDEX IF NOT EXISTS idx_mkt_events_content_id ON mkt_approval_events (content_id);
CREATE INDEX IF NOT EXISTS idx_mkt_events_actor      ON mkt_approval_events (actor_employee_id);
CREATE INDEX IF NOT EXISTS idx_mkt_events_created_at ON mkt_approval_events (created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Employee usage events (downloads + copies + share). Also survives deletion.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mkt_downloads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id   uuid REFERENCES mkt_content(id) ON DELETE SET NULL,
  content_no   text NOT NULL,
  employee_id  uuid NOT NULL REFERENCES nw_employees(id) ON DELETE CASCADE,
  event_type   text NOT NULL CHECK (event_type IN
                 ('download_poster','download_video','copy_caption','copy_hashtags','share_link')),
  variant      text NOT NULL DEFAULT '',
  platform     text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_downloads_content_no ON mkt_downloads (content_no);
CREATE INDEX IF NOT EXISTS idx_mkt_downloads_content_id ON mkt_downloads (content_id);
CREATE INDEX IF NOT EXISTS idx_mkt_downloads_employee   ON mkt_downloads (employee_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Content history — the slim survivor row (see header). Written by the
--    expiry/delete edge function immediately before the hard delete.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mkt_content_history (
  content_no     text PRIMARY KEY,
  category       text NOT NULL DEFAULT '',
  topic          text NOT NULL DEFAULT '',
  content_type   text NOT NULL DEFAULT '',
  platforms      text[] NOT NULL DEFAULT '{}',
  title          text NOT NULL DEFAULT '',
  headline       text NOT NULL DEFAULT '',
  hashtags       text[] NOT NULL DEFAULT '{}',
  final_status   text NOT NULL DEFAULT '',
  download_count integer NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at     timestamptz,
  approved_at    timestamptz,
  deleted_at     timestamptz NOT NULL DEFAULT now(),
  delete_reason  text NOT NULL CHECK (delete_reason IN ('expired','admin_deleted'))
);

CREATE INDEX IF NOT EXISTS idx_mkt_history_category ON mkt_content_history (category);
CREATE INDEX IF NOT EXISTS idx_mkt_history_deleted  ON mkt_content_history (deleted_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Deletion log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mkt_deletion_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_no     text NOT NULL,
  deleted_by     uuid REFERENCES nw_employees(id) ON DELETE SET NULL, -- NULL = system expiry
  reason         text NOT NULL,
  assets_deleted jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_deletion_logs_content_no ON mkt_deletion_logs (content_no);
CREATE INDEX IF NOT EXISTS idx_mkt_deletion_logs_deleted_by ON mkt_deletion_logs (deleted_by);

-- ---------------------------------------------------------------------------
-- 8. Status transitions — the ONLY approval path.
--    Centralised so expires_at is always derived from the server clock and an
--    audit event is always written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mkt_set_content_status(
  p_content_id uuid,
  p_action     text,
  p_note       text DEFAULT ''
)
RETURNS mkt_content
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_row   mkt_content;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only admins can change content status';
  END IF;

  IF p_action NOT IN ('approved','rejected','archived') THEN
    RAISE EXCEPTION 'Unsupported action: %', p_action;
  END IF;

  v_actor := nw_current_employee_id();

  IF p_action = 'approved' THEN
    UPDATE mkt_content SET
      status      = 'approved',
      approved_by = v_actor,
      approved_at = now(),
      -- 48h of visibility. Scheduled content starts its clock when it actually
      -- becomes visible, so employees always get the full window.
      expires_at  = greatest(now(), COALESCE(scheduled_publish_at, now())) + interval '48 hours'
    WHERE id = p_content_id
    RETURNING * INTO v_row;
  ELSIF p_action = 'rejected' THEN
    UPDATE mkt_content SET
      status        = 'rejected',
      reject_reason = COALESCE(p_note, ''),
      expires_at    = NULL
    WHERE id = p_content_id
    RETURNING * INTO v_row;
  ELSE
    UPDATE mkt_content SET status = 'archived', expires_at = NULL
    WHERE id = p_content_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Content not found: %', p_content_id;
  END IF;

  INSERT INTO mkt_approval_events (content_id, content_no, action, actor_employee_id, note)
  VALUES (v_row.id, v_row.content_no, p_action, v_actor, COALESCE(p_note, ''));

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION mkt_set_content_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mkt_set_content_status(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE mkt_content          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_content_assets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_approval_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_downloads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_content_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mkt_deletion_logs    ENABLE ROW LEVEL SECURITY;

-- --- mkt_content -----------------------------------------------------------
DROP POLICY IF EXISTS "Admins manage marketing content"        ON mkt_content;
DROP POLICY IF EXISTS "Admins create marketing content"        ON mkt_content;
DROP POLICY IF EXISTS "Admins update marketing content"        ON mkt_content;
DROP POLICY IF EXISTS "Employees read live approved content"   ON mkt_content;

CREATE POLICY "Admins manage marketing content"
  ON mkt_content FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

CREATE POLICY "Admins create marketing content"
  ON mkt_content FOR INSERT TO authenticated
  WITH CHECK (nw_current_emp_is_admin());

CREATE POLICY "Admins update marketing content"
  ON mkt_content FOR UPDATE TO authenticated
  USING (nw_current_emp_is_admin())
  WITH CHECK (nw_current_emp_is_admin());

-- Employees never see drafts, rejects, archives, scheduled-for-later or expired.
CREATE POLICY "Employees read live approved content"
  ON mkt_content FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND expires_at IS NOT NULL
    AND expires_at > now()
    AND (scheduled_publish_at IS NULL OR scheduled_publish_at <= now())
    AND nw_current_employee_id() IS NOT NULL
  );

-- NOTE: no DELETE policy, by design. See header.

-- --- mkt_content_assets ----------------------------------------------------
DROP POLICY IF EXISTS "Admins read marketing assets"       ON mkt_content_assets;
DROP POLICY IF EXISTS "Admins create marketing assets"     ON mkt_content_assets;
DROP POLICY IF EXISTS "Admins update marketing assets"     ON mkt_content_assets;
DROP POLICY IF EXISTS "Employees read live content assets" ON mkt_content_assets;

CREATE POLICY "Admins read marketing assets"
  ON mkt_content_assets FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

CREATE POLICY "Admins create marketing assets"
  ON mkt_content_assets FOR INSERT TO authenticated
  WITH CHECK (nw_current_emp_is_admin());

CREATE POLICY "Admins update marketing assets"
  ON mkt_content_assets FOR UPDATE TO authenticated
  USING (nw_current_emp_is_admin())
  WITH CHECK (nw_current_emp_is_admin());

CREATE POLICY "Employees read live content assets"
  ON mkt_content_assets FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM mkt_content c
    WHERE c.id = mkt_content_assets.content_id
      AND c.status = 'approved'
      AND c.expires_at IS NOT NULL
      AND c.expires_at > now()
      AND (c.scheduled_publish_at IS NULL OR c.scheduled_publish_at <= now())
  ));

-- --- mkt_approval_events ---------------------------------------------------
DROP POLICY IF EXISTS "Admins read approval events"  ON mkt_approval_events;
DROP POLICY IF EXISTS "Admins write approval events" ON mkt_approval_events;

CREATE POLICY "Admins read approval events"
  ON mkt_approval_events FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

CREATE POLICY "Admins write approval events"
  ON mkt_approval_events FOR INSERT TO authenticated
  WITH CHECK (nw_current_emp_is_admin());

-- --- mkt_downloads ---------------------------------------------------------
DROP POLICY IF EXISTS "Admins read all download events"    ON mkt_downloads;
DROP POLICY IF EXISTS "Employees read own download events" ON mkt_downloads;
DROP POLICY IF EXISTS "Employees log own download events"  ON mkt_downloads;

CREATE POLICY "Admins read all download events"
  ON mkt_downloads FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

CREATE POLICY "Employees read own download events"
  ON mkt_downloads FOR SELECT TO authenticated
  USING (employee_id = nw_current_employee_id());

-- An employee can only ever log activity as themselves.
CREATE POLICY "Employees log own download events"
  ON mkt_downloads FOR INSERT TO authenticated
  WITH CHECK (employee_id = nw_current_employee_id());

-- --- history + deletion logs (admin read only; service role writes) --------
DROP POLICY IF EXISTS "Admins read content history" ON mkt_content_history;
DROP POLICY IF EXISTS "Admins read deletion logs"   ON mkt_deletion_logs;

CREATE POLICY "Admins read content history"
  ON mkt_content_history FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

CREATE POLICY "Admins read deletion logs"
  ON mkt_deletion_logs FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());
