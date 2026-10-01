-- Shared mobile / email between related clients (husband & wife, parent & child).
--
-- Two clients may carry the same mobile number or email ONLY when both sit
-- under the same employee. When that happens the RM records how the new client
-- is related to the existing one; the answer lives here.
--
-- Read as: client_id is the <relationship> of related_client_id.

CREATE TABLE IF NOT EXISTS nw_client_relationships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,
  related_client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,
  relationship      text NOT NULL CHECK (length(trim(relationship)) > 0),
  shared_contact    text NOT NULL CHECK (shared_contact IN ('phone', 'email', 'both')),
  created_by        uuid REFERENCES nw_employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, related_client_id),
  CHECK (client_id <> related_client_id)
);

CREATE INDEX IF NOT EXISTS idx_nw_client_relationships_related
  ON nw_client_relationships (related_client_id);
CREATE INDEX IF NOT EXISTS idx_nw_client_relationships_created_by
  ON nw_client_relationships (created_by);

ALTER TABLE nw_client_relationships ENABLE ROW LEVEL SECURITY;

-- Same visibility rule as nw_clients itself: the owning employee, or an admin.
DROP POLICY IF EXISTS "Employees manage relationships of their clients" ON nw_client_relationships;
CREATE POLICY "Employees manage relationships of their clients"
  ON nw_client_relationships FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM nw_employees e
    WHERE e.auth_user_id = (SELECT auth.uid()) AND e.status = 'active'
      AND (e.role IN ('admin', 'super_admin')
           OR e.id = (SELECT c.employee_id FROM nw_clients c WHERE c.id = nw_client_relationships.client_id))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM nw_employees e
    WHERE e.auth_user_id = (SELECT auth.uid()) AND e.status = 'active'
      AND (e.role IN ('admin', 'super_admin')
           OR e.id = (SELECT c.employee_id FROM nw_clients c WHERE c.id = nw_client_relationships.client_id))));

REVOKE ALL ON nw_client_relationships FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON nw_client_relationships TO authenticated;

-- Who already uses this mobile / email?
--
-- SECURITY DEFINER because an employee's RLS only shows their own clients, so
-- a plain query can never see that another employee's client holds the number.
-- Clients of the SAME employee come back with name + code (the RM is asked the
-- relationship); a client of ANOTHER employee comes back as a bare
-- same_employee = false row with no identifying fields, unless the caller is an
-- admin. p_exclude_client_id is the client being edited.
CREATE OR REPLACE FUNCTION nw_client_contact_matches(
  p_phone             text,
  p_email             text,
  p_employee_id       uuid,
  p_exclude_client_id uuid DEFAULT NULL
)
RETURNS TABLE (
  client_id             uuid,
  full_name             text,
  client_code           text,
  matched_on            text,
  same_employee         boolean,
  existing_relationship text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
  v_phone     text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_email     text := lower(trim(coalesce(p_email, '')));
BEGIN
  SELECT e.id, e.role IN ('admin', 'super_admin')
    INTO v_caller_id, v_is_admin
  FROM nw_employees e
  WHERE e.auth_user_id = auth.uid() AND e.status = 'active';

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  -- A non-admin may only ask on behalf of their own book.
  IF NOT v_is_admin AND p_employee_id IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF length(v_phone) < 10 THEN v_phone := ''; END IF;

  RETURN QUERY
  SELECT
    CASE WHEN m.same_emp OR v_is_admin THEN m.id END,
    CASE WHEN m.same_emp OR v_is_admin THEN m.full_name END,
    CASE WHEN m.same_emp OR v_is_admin THEN m.client_code END,
    CASE WHEN m.phone_hit AND m.email_hit THEN 'both'
         WHEN m.phone_hit THEN 'phone' ELSE 'email' END,
    m.same_emp,
    (SELECT r.relationship FROM nw_client_relationships r
      WHERE p_exclude_client_id IS NOT NULL
        AND ((r.client_id = p_exclude_client_id AND r.related_client_id = m.id)
          OR (r.client_id = m.id AND r.related_client_id = p_exclude_client_id))
      LIMIT 1)
  FROM (
    SELECT c.id, c.full_name, c.client_code, c.created_at,
           (v_phone <> '' AND right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = v_phone) AS phone_hit,
           (v_email <> '' AND lower(trim(coalesce(c.email, ''))) = v_email) AS email_hit,
           (p_employee_id IS NOT NULL AND c.employee_id = p_employee_id) AS same_emp
    FROM nw_clients c
    WHERE c.id IS DISTINCT FROM p_exclude_client_id
  ) m
  WHERE m.phone_hit OR m.email_hit
  ORDER BY m.created_at;
END;
$$;

REVOKE ALL ON FUNCTION nw_client_contact_matches(text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_client_contact_matches(text, text, uuid, uuid) TO authenticated;
