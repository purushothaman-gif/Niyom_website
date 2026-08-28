-- Client bond ordering: richer client-facing bond projection (detail page) + a
-- bond-orders table that routes a placed order to the client's RM (in-app alert
-- here; the edge function also emails). Confidentiality unchanged: clients only
-- ever see the approved marked-up price; never latest_price / landing_cost / margin.

-- 1) Extend the client bond list with the extra safe fields the detail page needs.
--    Return type changes, so drop the old signature first.
DROP FUNCTION IF EXISTS nw_client_bonds();
CREATE OR REPLACE FUNCTION nw_client_bonds()
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text,
  min_investment numeric, face_value numeric, client_price numeric, analytics jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := nw_current_client_id(); v_emp uuid; v_m numeric;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Client access required'; END IF;
  SELECT c.employee_id INTO v_emp FROM nw_clients c WHERE c.id = v_client;
  v_m := bm_resolve_markup('client', v_client, NULL, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_type, b.coupon_frequency,
           b.maturity_date, b.next_coupon_date, b.issue_date, b.rating, b.rating_agency,
           b.security_type, b.tax_status, b.trustee, b.day_count_convention, b.principal_repayment_structure,
           b.min_investment, b.face_value, round(b.latest_price * (1 + v_m/100), 4), b.analytics
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.active_status='active' AND b.latest_price IS NOT NULL
    ORDER BY b.bond_name;
END; $$;

-- 2) Single-bond detail (same shape), for the detail page. Empty if not resolvable for this client.
CREATE OR REPLACE FUNCTION nw_client_bond(p_id uuid)
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text,
  min_investment numeric, face_value numeric, client_price numeric, analytics jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := nw_current_client_id(); v_emp uuid; v_m numeric;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Client access required'; END IF;
  SELECT c.employee_id INTO v_emp FROM nw_clients c WHERE c.id = v_client;
  v_m := bm_resolve_markup('client', v_client, NULL, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_type, b.coupon_frequency,
           b.maturity_date, b.next_coupon_date, b.issue_date, b.rating, b.rating_agency,
           b.security_type, b.tax_status, b.trustee, b.day_count_convention, b.principal_repayment_structure,
           b.min_investment, b.face_value, round(b.latest_price * (1 + v_m/100), 4), b.analytics
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.id = p_id AND b.active_status='active' AND b.latest_price IS NOT NULL;
END; $$;

-- 3) Bond orders (client places -> routed to the RM). Insert happens via the
--    place-bond-order edge function (service role); clients only SELECT their own.
CREATE TABLE IF NOT EXISTS nw_bond_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL DEFAULT ('ORD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,
  bond_id uuid REFERENCES bm_bonds(id) ON DELETE SET NULL,
  assigned_employee_id uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  isin text NOT NULL DEFAULT '',
  bond_name text NOT NULL DEFAULT '',
  units integer NOT NULL CHECK (units > 0),
  price_per_100 numeric NOT NULL,           -- client_price snapshot at order time (server-derived)
  face_value numeric,
  amount numeric,                            -- indicative amount payable (principal + accrued)
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','deal_sent','accepted','cancelled')),
  deal_id uuid REFERENCES nw_deal_confirmations(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nw_bond_orders_client_idx  ON nw_bond_orders (client_id);
CREATE INDEX IF NOT EXISTS nw_bond_orders_emp_idx     ON nw_bond_orders (assigned_employee_id);
CREATE INDEX IF NOT EXISTS nw_bond_orders_status_idx  ON nw_bond_orders (status);

ALTER TABLE nw_bond_orders ENABLE ROW LEVEL SECURITY;

-- Client reads own orders.
CREATE POLICY nw_bond_orders_client_read ON nw_bond_orders FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM nw_clients WHERE client_auth_user_id = (SELECT auth.uid())));
-- Staff: admin all, else the client's owning RM (mirror nw_holdings).
CREATE POLICY nw_bond_orders_staff_read ON nw_bond_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM nw_clients c JOIN nw_employees e ON e.auth_user_id = (SELECT auth.uid())
                 WHERE c.id = nw_bond_orders.client_id AND e.status='active'
                   AND (e.role IN ('admin','super_admin') OR e.id = c.employee_id)));
-- Staff may update status/notes/deal_id on their own clients' orders (admin all).
CREATE POLICY nw_bond_orders_staff_update ON nw_bond_orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM nw_clients c JOIN nw_employees e ON e.auth_user_id = (SELECT auth.uid())
                 WHERE c.id = nw_bond_orders.client_id AND e.status='active'
                   AND (e.role IN ('admin','super_admin') OR e.id = c.employee_id)))
  WITH CHECK (true);
-- (No client/anon INSERT policy — inserts go through the service-role edge function.)

CREATE TRIGGER nw_bond_orders_touch BEFORE UPDATE ON nw_bond_orders
  FOR EACH ROW EXECUTE FUNCTION bm_touch_updated_at();

-- 4) Alert the RM in-app when a new order lands (modeled on client_reassignment).
CREATE OR REPLACE FUNCTION nw_notify_rm_on_bond_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid; v_client text;
BEGIN
  SELECT employee_id, full_name INTO v_emp, v_client FROM nw_clients WHERE id = NEW.client_id;
  IF v_emp IS NOT NULL THEN
    INSERT INTO nw_alerts(employee_id, title, message, category, action_url)
    VALUES (v_emp, 'New Bond Order',
            coalesce(v_client,'A client') || ' placed an order: ' || NEW.units || ' unit(s) of ' || NEW.bond_name,
            'bond_order', '/bond-orders');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS nw_bond_orders_notify ON nw_bond_orders;
CREATE TRIGGER nw_bond_orders_notify AFTER INSERT ON nw_bond_orders
  FOR EACH ROW EXECUTE FUNCTION nw_notify_rm_on_bond_order();

REVOKE ALL ON FUNCTION nw_client_bond(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_client_bond(uuid) TO authenticated;
