/*
  # Unlisted Shares — per-client / per-partner price blocks

  A markup is a REVENUE decision; a block is an ACCESS decision, and the two do
  not belong in the same row. Until now the only way to hide prices from one
  client was to have no approved rate reach them — impossible once a company-wide
  rate exists, because that rate is the last resort in us_resolve_markup and
  applies to everyone by definition.

  So: an explicit deny list that us_resolve_markup consults FIRST. A blocked
  client or partner resolves to NULL exactly as if nothing had ever been
  approved, which means the block is enforced in one place and inherited by every
  caller — the client list and detail, the partner list and detail,
  place-share-order, place-partner-share-order and the offer functions all route
  through this one function. There is no second code path to keep in sync, and no
  way to order a share whose price you were never allowed to see.

  ## Who may block, and who may lift it

  Blocking is restrictive, so it takes effect immediately rather than queuing for
  approval — making someone WAIT to be denied access has the risk backwards. An
  RM may block their own client or partner; an admin may block anyone.

  Lifting a block GRANTS access, so it is not symmetric: a block an admin placed
  carries admin_lock and only an admin can remove it. Otherwise an RM could undo
  a compliance decision made above them by toggling a switch on their own screen.
*/

CREATE TABLE IF NOT EXISTS us_price_block (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('client','partner')),
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,
  dsa_id uuid REFERENCES nw_dsa(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  -- Set when an admin placed the block; only an admin can then lift it.
  admin_lock boolean NOT NULL DEFAULT false,
  blocked_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT us_price_block_shape CHECK (
       (audience='client'  AND client_id IS NOT NULL AND dsa_id IS NULL)
    OR (audience='partner' AND dsa_id   IS NOT NULL AND client_id IS NULL)
  )
);

-- One block per target: the deny list is a set, not a log.
CREATE UNIQUE INDEX IF NOT EXISTS us_price_block_uq_client ON us_price_block (client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS us_price_block_uq_dsa    ON us_price_block (dsa_id)    WHERE dsa_id   IS NOT NULL;

ALTER TABLE us_price_block ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS us_price_block_admin_all ON us_price_block;
CREATE POLICY us_price_block_admin_all ON us_price_block FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

-- An RM sees the blocks on their own book, so the toggle on their pricing screen
-- reflects reality. Writes go through the RPCs below.
DROP POLICY IF EXISTS us_price_block_rm_read ON us_price_block;
CREATE POLICY us_price_block_rm_read ON us_price_block FOR SELECT TO authenticated
  USING (
       (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM nw_clients c WHERE c.id = client_id AND c.employee_id = (SELECT nw_current_employee_id())))
    OR (dsa_id   IS NOT NULL AND (SELECT nw_emp_owns_dsa(dsa_id)))
  );

-- ---------------------------------------------------------------------------
-- Resolution, with the deny list consulted before any rate is considered.
-- Everything else about this function is unchanged from 20260831121000.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION us_resolve_markup(p_audience text, p_client_id uuid, p_dsa_id uuid, p_employee_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m numeric;
BEGIN
  -- Access before price. A blocked target resolves to NULL no matter what has
  -- been approved for them, for their RM, or company-wide.
  IF p_audience = 'client' AND p_client_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM us_price_block b WHERE b.client_id = p_client_id) THEN
    RETURN NULL;
  END IF;
  IF p_audience = 'partner' AND p_dsa_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM us_price_block b WHERE b.dsa_id = p_dsa_id) THEN
    RETURN NULL;
  END IF;

  IF p_audience = 'client' AND p_client_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM us_price_markup
     WHERE status='approved' AND audience='client' AND scope='individual' AND client_id = p_client_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  ELSIF p_audience = 'partner' AND p_dsa_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM us_price_markup
     WHERE status='approved' AND audience='partner' AND scope='individual' AND dsa_id = p_dsa_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  END IF;
  IF p_employee_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM us_price_markup
     WHERE status='approved' AND audience=p_audience AND scope='group' AND employee_id = p_employee_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  END IF;
  SELECT markup_percent INTO m FROM us_price_markup
   WHERE status='approved' AND audience=p_audience AND scope='group' AND employee_id IS NULL LIMIT 1;
  RETURN m;   -- NULL when nothing approved applies
END; $$;

-- ---------------------------------------------------------------------------
-- Block / unblock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION us_block_price(p_audience text, p_client_id uuid, p_dsa_id uuid, p_reason text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id(); v_admin boolean := nw_current_emp_is_admin(); v_id uuid;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Staff only'; END IF;
  IF p_audience NOT IN ('client','partner') THEN RAISE EXCEPTION 'Bad audience'; END IF;

  IF p_audience = 'client' THEN
    IF p_client_id IS NULL THEN RAISE EXCEPTION 'client_id required'; END IF;
    IF NOT (v_admin OR EXISTS (SELECT 1 FROM nw_clients c WHERE c.id = p_client_id AND c.employee_id = v_emp)) THEN
      RAISE EXCEPTION 'Not your client';
    END IF;
    INSERT INTO us_price_block (audience, client_id, reason, admin_lock, blocked_by)
    VALUES ('client', p_client_id, coalesce(p_reason,''), v_admin, v_emp)
    ON CONFLICT (client_id) WHERE client_id IS NOT NULL
    DO UPDATE SET reason = EXCLUDED.reason,
                  -- Re-blocking by an admin escalates the lock; an RM re-blocking
                  -- an admin-locked row must not quietly downgrade it.
                  admin_lock = us_price_block.admin_lock OR EXCLUDED.admin_lock
    RETURNING id INTO v_id;
  ELSE
    IF p_dsa_id IS NULL THEN RAISE EXCEPTION 'dsa_id required'; END IF;
    IF NOT (v_admin OR nw_emp_owns_dsa(p_dsa_id)) THEN RAISE EXCEPTION 'Not your partner'; END IF;
    INSERT INTO us_price_block (audience, dsa_id, reason, admin_lock, blocked_by)
    VALUES ('partner', p_dsa_id, coalesce(p_reason,''), v_admin, v_emp)
    ON CONFLICT (dsa_id) WHERE dsa_id IS NOT NULL
    DO UPDATE SET reason = EXCLUDED.reason,
                  admin_lock = us_price_block.admin_lock OR EXCLUDED.admin_lock
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION us_unblock_price(p_audience text, p_client_id uuid, p_dsa_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id(); v_admin boolean := nw_current_emp_is_admin(); v_locked boolean;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Staff only'; END IF;

  IF p_audience = 'client' THEN
    IF p_client_id IS NULL THEN RAISE EXCEPTION 'client_id required'; END IF;
    IF NOT (v_admin OR EXISTS (SELECT 1 FROM nw_clients c WHERE c.id = p_client_id AND c.employee_id = v_emp)) THEN
      RAISE EXCEPTION 'Not your client';
    END IF;
    SELECT admin_lock INTO v_locked FROM us_price_block WHERE client_id = p_client_id;
    IF v_locked IS NULL THEN RETURN; END IF;              -- already unblocked
    IF v_locked AND NOT v_admin THEN
      RAISE EXCEPTION 'This block was set by an administrator and only an administrator can lift it.';
    END IF;
    DELETE FROM us_price_block WHERE client_id = p_client_id;
  ELSIF p_audience = 'partner' THEN
    IF p_dsa_id IS NULL THEN RAISE EXCEPTION 'dsa_id required'; END IF;
    IF NOT (v_admin OR nw_emp_owns_dsa(p_dsa_id)) THEN RAISE EXCEPTION 'Not your partner'; END IF;
    SELECT admin_lock INTO v_locked FROM us_price_block WHERE dsa_id = p_dsa_id;
    IF v_locked IS NULL THEN RETURN; END IF;
    IF v_locked AND NOT v_admin THEN
      RAISE EXCEPTION 'This block was set by an administrator and only an administrator can lift it.';
    END IF;
    DELETE FROM us_price_block WHERE dsa_id = p_dsa_id;
  ELSE
    RAISE EXCEPTION 'Bad audience';
  END IF;
END; $$;

REVOKE ALL ON FUNCTION us_block_price(text,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION us_unblock_price(text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION us_block_price(text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION us_unblock_price(text,uuid,uuid) TO authenticated;
