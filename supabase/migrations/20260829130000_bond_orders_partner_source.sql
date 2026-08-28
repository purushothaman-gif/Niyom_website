-- Partner attribution on bond orders. A partner can place a bond order on behalf
-- of one of their own clients (source='partner'), at the partner's per-bond price;
-- the order still routes to the client's RM (assigned_employee_id) exactly like a
-- client-placed order. dsa_id + partner_markup_percent are recorded for attribution.

ALTER TABLE nw_bond_orders
  ADD COLUMN IF NOT EXISTS dsa_id uuid REFERENCES nw_dsa(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_markup_percent numeric,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'client';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nw_bond_orders_source_chk') THEN
    ALTER TABLE nw_bond_orders ADD CONSTRAINT nw_bond_orders_source_chk CHECK (source IN ('client','partner'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS nw_bond_orders_dsa_idx ON nw_bond_orders (dsa_id);

-- A partner can read the orders they raised (attribution view). RM/admin read is
-- unchanged (still scoped by the client's owning employee).
DROP POLICY IF EXISTS nw_bond_orders_partner_read ON nw_bond_orders;
CREATE POLICY nw_bond_orders_partner_read ON nw_bond_orders FOR SELECT TO authenticated
  USING (dsa_id IS NOT NULL AND dsa_id = nw_current_dsa_id());
