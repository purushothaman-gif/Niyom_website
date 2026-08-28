-- Partner shareable bond links. A partner mints a per-bond link (carrying a per-bond
-- margin) they can send to a client; the public /bond-offer page resolves it to the
-- bond at the partner's price. Resolution + ordering happen through service-role edge
-- functions, so the token row itself is only readable by the owning partner.

CREATE TABLE IF NOT EXISTS nw_partner_bond_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  dsa_id uuid NOT NULL REFERENCES nw_dsa(id) ON DELETE CASCADE,
  bond_id uuid NOT NULL REFERENCES bm_bonds(id) ON DELETE CASCADE,
  margin_percent numeric NOT NULL DEFAULT 0 CHECK (margin_percent >= 0 AND margin_percent <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS nw_partner_bond_shares_dsa_idx ON nw_partner_bond_shares (dsa_id);

ALTER TABLE nw_partner_bond_shares ENABLE ROW LEVEL SECURITY;

-- The owning partner may read their own share links (for a "Shared links" list).
DROP POLICY IF EXISTS nw_partner_bond_shares_owner_read ON nw_partner_bond_shares;
CREATE POLICY nw_partner_bond_shares_owner_read ON nw_partner_bond_shares FOR SELECT TO authenticated
  USING (dsa_id = nw_current_dsa_id());
-- (No public/anon policy — resolution goes through the service-role edge function.)

-- Partner mints a share link for a bond at a per-bond margin (0..5%). Returns the token.
CREATE OR REPLACE FUNCTION nw_partner_create_bond_share(p_bond_id uuid, p_margin numeric)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id(); v_token text;
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  IF p_margin IS NULL OR p_margin < 0 OR p_margin > 5 THEN
    RAISE EXCEPTION 'Your margin must be between 0%% and 5%%.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bm_bonds WHERE id = p_bond_id AND active_status='active' AND latest_price IS NOT NULL) THEN
    RAISE EXCEPTION 'This bond is not available.';
  END IF;
  v_token := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  INSERT INTO nw_partner_bond_shares (token, dsa_id, bond_id, margin_percent)
  VALUES (v_token, v_dsa, p_bond_id, p_margin);
  RETURN v_token;
END; $$;

REVOKE ALL ON FUNCTION nw_partner_create_bond_share(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_partner_create_bond_share(uuid, numeric) TO authenticated;
