/*
  # Unlisted Shares — orders and partner shareable offer links

  Mirrors nw_bond_orders (20260828130000 + 20260829130000) and
  nw_partner_bond_shares (20260829140000), with the one structural difference
  that matters: a share is bought by QUANTITY at a price PER SHARE, so there is
  no face value, no lot arithmetic over ₹100 and no accrued interest. The
  indicative amount is simply qty × price_per_share.

  Inserts are service-role only (the place-share-order / place-partner-share-order
  edge functions), which is what lets the price be re-derived server-side. A
  client-sent price is never trusted, on either surface.
*/

CREATE TABLE IF NOT EXISTS nw_share_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL DEFAULT ('USO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,
  share_id uuid REFERENCES us_shares(id) ON DELETE SET NULL,
  assigned_employee_id uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  isin text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  qty integer NOT NULL CHECK (qty > 0),
  price_per_share numeric NOT NULL,      -- server-derived snapshot at order time
  amount numeric,                        -- indicative: qty × price_per_share
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','deal_sent','accepted','cancelled')),
  deal_id uuid REFERENCES nw_deal_confirmations(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  -- Partner attribution (source='partner'): the order still routes to the
  -- client's own RM, exactly like a client-placed one.
  dsa_id uuid REFERENCES nw_dsa(id) ON DELETE SET NULL,
  partner_markup_percent numeric,
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('client','partner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nw_share_orders_client_idx ON nw_share_orders (client_id);
CREATE INDEX IF NOT EXISTS nw_share_orders_emp_idx    ON nw_share_orders (assigned_employee_id);
CREATE INDEX IF NOT EXISTS nw_share_orders_status_idx ON nw_share_orders (status);
CREATE INDEX IF NOT EXISTS nw_share_orders_dsa_idx    ON nw_share_orders (dsa_id);

ALTER TABLE nw_share_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nw_share_orders_client_read ON nw_share_orders;
CREATE POLICY nw_share_orders_client_read ON nw_share_orders FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM nw_clients WHERE client_auth_user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS nw_share_orders_partner_read ON nw_share_orders;
CREATE POLICY nw_share_orders_partner_read ON nw_share_orders FOR SELECT TO authenticated
  USING (dsa_id IS NOT NULL AND dsa_id = nw_current_dsa_id());

DROP POLICY IF EXISTS nw_share_orders_staff_read ON nw_share_orders;
CREATE POLICY nw_share_orders_staff_read ON nw_share_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM nw_clients c JOIN nw_employees e ON e.auth_user_id = (SELECT auth.uid())
                 WHERE c.id = nw_share_orders.client_id AND e.status='active'
                   AND (e.role IN ('admin','super_admin') OR e.id = c.employee_id)));

DROP POLICY IF EXISTS nw_share_orders_staff_update ON nw_share_orders;
CREATE POLICY nw_share_orders_staff_update ON nw_share_orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM nw_clients c JOIN nw_employees e ON e.auth_user_id = (SELECT auth.uid())
                 WHERE c.id = nw_share_orders.client_id AND e.status='active'
                   AND (e.role IN ('admin','super_admin') OR e.id = c.employee_id)))
  WITH CHECK (true);

DROP TRIGGER IF EXISTS nw_share_orders_touch ON nw_share_orders;
CREATE TRIGGER nw_share_orders_touch BEFORE UPDATE ON nw_share_orders
  FOR EACH ROW EXECUTE FUNCTION bm_touch_updated_at();

CREATE OR REPLACE FUNCTION nw_notify_rm_on_share_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid; v_client text;
BEGIN
  SELECT employee_id, full_name INTO v_emp, v_client FROM nw_clients WHERE id = NEW.client_id;
  IF v_emp IS NOT NULL THEN
    INSERT INTO nw_alerts(employee_id, title, message, category, action_url)
    VALUES (v_emp, 'New Unlisted Share Order',
            coalesce(v_client,'A client') || ' placed an order: ' || NEW.qty || ' share(s) of ' || NEW.company_name,
            'share_order', '/share-orders');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS nw_share_orders_notify ON nw_share_orders;
CREATE TRIGGER nw_share_orders_notify AFTER INSERT ON nw_share_orders
  FOR EACH ROW EXECUTE FUNCTION nw_notify_rm_on_share_order();

-- ---------------------------------------------------------------------------
-- Partner shareable offer links. A partner mints a per-share link carrying the
-- margin they chose for it; the public /share-offer page resolves the token
-- through a service-role edge function, so the token row stays unreadable to
-- anon and the partner's own cost never travels with the link.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nw_partner_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  dsa_id uuid NOT NULL REFERENCES nw_dsa(id) ON DELETE CASCADE,
  share_id uuid NOT NULL REFERENCES us_shares(id) ON DELETE CASCADE,
  margin_percent numeric NOT NULL DEFAULT 0 CHECK (margin_percent >= 0 AND margin_percent <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS nw_partner_share_links_dsa_idx ON nw_partner_share_links (dsa_id);

ALTER TABLE nw_partner_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nw_partner_share_links_owner_read ON nw_partner_share_links;
CREATE POLICY nw_partner_share_links_owner_read ON nw_partner_share_links FOR SELECT TO authenticated
  USING (dsa_id = nw_current_dsa_id());

CREATE OR REPLACE FUNCTION nw_partner_create_share_link(p_share_id uuid, p_margin numeric)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id(); v_token text;
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  IF p_margin IS NULL OR p_margin < 0 OR p_margin > 5 THEN
    RAISE EXCEPTION 'Your margin must be between 0%% and 5%%.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM us_shares WHERE id = p_share_id AND active_status='active' AND latest_price IS NOT NULL) THEN
    RAISE EXCEPTION 'This share is not available.';
  END IF;
  v_token := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  INSERT INTO nw_partner_share_links (token, dsa_id, share_id, margin_percent)
  VALUES (v_token, v_dsa, p_share_id, p_margin);
  RETURN v_token;
END; $$;

REVOKE ALL ON FUNCTION nw_partner_create_share_link(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_partner_create_share_link(uuid, numeric) TO authenticated;
