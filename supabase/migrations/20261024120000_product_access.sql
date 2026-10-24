-- Product access: which products (Mutual Funds, Bonds, Unlisted Shares, ...) a
-- client or partner sees in their portal.
--
-- Two layers, resolved most-specific first:
--   1. nw_product_overrides — one client or one partner (admin or the assigned RM)
--   2. nw_product_defaults  — everyone in an audience (admin only)
-- Anything unresolved is ENABLED, so seeding nothing keeps today's behaviour.
--
-- Product keys are the portal nav keys verbatim, so the frontend needs no mapping.
-- Hiding is enforced twice: the portals drop the nav item + route, and order
-- triggers below refuse a bond/share order for a product that is switched off.

CREATE TABLE IF NOT EXISTS nw_product_defaults (
  audience text NOT NULL CHECK (audience IN ('client','partner')),
  product text NOT NULL CHECK (product IN ('mutual-funds','bonds','unlisted-shares','fixed-deposits','insurance')),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audience, product)
);

CREATE TABLE IF NOT EXISTS nw_product_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('client','partner')),
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,
  dsa_id uuid REFERENCES nw_dsa(id) ON DELETE CASCADE,
  product text NOT NULL CHECK (product IN ('mutual-funds','bonds','unlisted-shares','fixed-deposits','insurance')),
  enabled boolean NOT NULL,
  updated_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nw_product_overrides_shape CHECK (
       (audience='client'  AND client_id IS NOT NULL AND dsa_id IS NULL)
    OR (audience='partner' AND dsa_id   IS NOT NULL AND client_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS nw_product_overrides_client_uq ON nw_product_overrides (client_id, product) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nw_product_overrides_dsa_uq    ON nw_product_overrides (dsa_id, product)    WHERE dsa_id IS NOT NULL;

INSERT INTO nw_product_defaults (audience, product) VALUES
  ('client','mutual-funds'), ('client','bonds'), ('client','unlisted-shares'),
  ('client','fixed-deposits'), ('client','insurance'),
  ('partner','mutual-funds'), ('partner','bonds'), ('partner','unlisted-shares')
ON CONFLICT DO NOTHING;

ALTER TABLE nw_product_defaults  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nw_product_overrides ENABLE ROW LEVEL SECURITY;

-- Defaults carry nothing sensitive; any signed-in surface may read them.
-- Writes for both tables go through the SECURITY DEFINER RPCs below.
CREATE POLICY nw_product_defaults_read ON nw_product_defaults FOR SELECT TO authenticated USING (true);

CREATE POLICY nw_product_overrides_staff_read ON nw_product_overrides FOR SELECT TO authenticated
  USING (
       (SELECT nw_current_emp_is_admin())
    OR (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM nw_clients c WHERE c.id = client_id AND c.employee_id = (SELECT nw_current_employee_id())))
    OR (dsa_id IS NOT NULL AND (SELECT nw_emp_owns_dsa(dsa_id)))
  );

-- Effective switch for one subject + product.
CREATE OR REPLACE FUNCTION nw_product_enabled(p_audience text, p_client_id uuid, p_dsa_id uuid, p_product text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT o.enabled FROM nw_product_overrides o
      WHERE o.product = p_product AND o.audience = p_audience
        AND ((p_audience = 'client' AND o.client_id = p_client_id) OR (p_audience = 'partner' AND o.dsa_id = p_dsa_id))),
    (SELECT d.enabled FROM nw_product_defaults d WHERE d.audience = p_audience AND d.product = p_product),
    true);
$$;

-- The caller's own product list (portals). Unknown caller -> every default.
CREATE OR REPLACE FUNCTION nw_my_products(p_audience text)
RETURNS TABLE (product text, enabled boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.product,
         nw_product_enabled(p_audience,
                            CASE WHEN p_audience = 'client'  THEN nw_current_client_id() END,
                            CASE WHEN p_audience = 'partner' THEN nw_current_dsa_id() END,
                            d.product)
  FROM nw_product_defaults d
  WHERE d.audience = p_audience;
$$;

-- Admin: set the audience-wide default.
CREATE OR REPLACE FUNCTION nw_set_product_default(p_audience text, p_product text, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change the default product list.';
  END IF;
  UPDATE nw_product_defaults
     SET enabled = p_enabled, updated_by = nw_current_employee_id(), updated_at = now()
   WHERE audience = p_audience AND product = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown product % for %', p_product, p_audience;
  END IF;
END; $$;

-- Admin or the assigned RM: override one client/partner. p_enabled NULL clears
-- the override so the subject follows the default again.
CREATE OR REPLACE FUNCTION nw_set_product_override(p_audience text, p_client_id uuid, p_dsa_id uuid, p_product text, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id();
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Not authorised.';
  END IF;
  IF NOT nw_current_emp_is_admin() THEN
    IF p_audience = 'client' AND NOT EXISTS (SELECT 1 FROM nw_clients WHERE id = p_client_id AND employee_id = v_emp) THEN
      RAISE EXCEPTION 'You can only change products for your own clients.';
    ELSIF p_audience = 'partner' AND NOT nw_emp_owns_dsa(p_dsa_id) THEN
      RAISE EXCEPTION 'You can only change products for your own partners.';
    END IF;
  END IF;

  IF p_enabled IS NULL THEN
    DELETE FROM nw_product_overrides
     WHERE product = p_product AND audience = p_audience
       AND ((p_audience = 'client' AND client_id = p_client_id) OR (p_audience = 'partner' AND dsa_id = p_dsa_id));
  ELSIF p_audience = 'client' THEN
    INSERT INTO nw_product_overrides (audience, client_id, product, enabled, updated_by)
    VALUES ('client', p_client_id, p_product, p_enabled, v_emp)
    ON CONFLICT (client_id, product) WHERE client_id IS NOT NULL
    DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
  ELSE
    INSERT INTO nw_product_overrides (audience, dsa_id, product, enabled, updated_by)
    VALUES ('partner', p_dsa_id, p_product, p_enabled, v_emp)
    ON CONFLICT (dsa_id, product) WHERE dsa_id IS NOT NULL
    DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
END; $$;

-- Server-side guard: a switched-off product cannot be ordered by the client, or
-- by a partner for that client. Staff-created rows are exempt.
CREATE OR REPLACE FUNCTION nw_guard_order_product() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product text := TG_ARGV[0];
BEGIN
  IF nw_current_employee_id() IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT nw_product_enabled('client', NEW.client_id, NULL, v_product) THEN
    RAISE EXCEPTION 'This product is not available for this client.';
  END IF;
  IF NEW.dsa_id IS NOT NULL AND NEW.source = 'partner'
     AND NOT nw_product_enabled('partner', NULL, NEW.dsa_id, v_product) THEN
    RAISE EXCEPTION 'This product is not available on your partner account.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS nw_bond_orders_product_guard ON nw_bond_orders;
CREATE TRIGGER nw_bond_orders_product_guard BEFORE INSERT ON nw_bond_orders
  FOR EACH ROW EXECUTE FUNCTION nw_guard_order_product('bonds');
DROP TRIGGER IF EXISTS nw_share_orders_product_guard ON nw_share_orders;
CREATE TRIGGER nw_share_orders_product_guard BEFORE INSERT ON nw_share_orders
  FOR EACH ROW EXECUTE FUNCTION nw_guard_order_product('unlisted-shares');

-- REVOKE FROM PUBLIC, anon does not touch `authenticated`; grant explicitly.
REVOKE ALL ON FUNCTION nw_product_enabled(text,uuid,uuid,text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_my_products(text)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_set_product_default(text,text,boolean)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_set_product_override(text,uuid,uuid,text,boolean)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_guard_order_product()                              FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION nw_my_products(text)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION nw_set_product_default(text,text,boolean)            TO authenticated;
GRANT EXECUTE ON FUNCTION nw_set_product_override(text,uuid,uuid,text,boolean) TO authenticated;
-- nw_product_enabled stays internal: authenticated callers could otherwise probe
-- any client's product list by id.
REVOKE ALL ON FUNCTION nw_product_enabled(text,uuid,uuid,text) FROM authenticated;
