/*
  # Unlisted Shares — security master + manual daily price book

  The unlisted-equity twin of the bond master (bm_*). Deliberately a separate
  namespace (us_*) rather than a product column on bm_bonds: a share has no
  coupon, no maturity and no accrued interest, it is priced PER SHARE rather
  than per ₹100 of face, and its price arrives by hand from the dealing desk
  instead of from the daily bond sheet. Sharing a table would have meant a dozen
  nullable columns and an "is it a bond?" branch in every projection.

  What is identical to bonds, on purpose:
    - the base price is INTERNAL. Clients and partners only ever see a price
      that an approved markup has been applied to (us_price_markup, next
      migration). `latest_price` never reaches a client-facing projection.
    - one row per ISIN, active_status gates visibility.

  Price entry is admin-only and dated: us_share_prices is an append/upsert log
  keyed (share_id, price_date), and a trigger mirrors the newest dated row onto
  us_shares.latest_price so every read path stays a single-table lookup.
*/

-- ---------------------------------------------------------------------------
-- Share master
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS us_shares (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isin              text NOT NULL UNIQUE,
  company_name      text NOT NULL,
  short_name        text NOT NULL DEFAULT '',
  sector            text NOT NULL DEFAULT '',
  about             text NOT NULL DEFAULT '',

  -- Marketing / identity
  logo_url          text NOT NULL DEFAULT '',      -- public URL in the share-logos bucket
  website           text NOT NULL DEFAULT '',

  -- Trading rules (per share, not per ₹100)
  face_value        numeric,
  lot_size          integer NOT NULL DEFAULT 1 CHECK (lot_size > 0),
  min_qty           integer NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  currency          text NOT NULL DEFAULT 'INR',

  -- Internal pricing (admin-only; never in a client/partner projection)
  latest_price      numeric CHECK (latest_price IS NULL OR latest_price > 0),
  price_date        date,
  price_updated_at  timestamptz,

  active_status     text NOT NULL DEFAULT 'active'
                      CHECK (active_status IN ('active','suspended','inactive')),
  display_order     integer NOT NULL DEFAULT 0,

  created_by        uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS us_shares_active_idx ON us_shares (active_status);
CREATE INDEX IF NOT EXISTS us_shares_order_idx  ON us_shares (display_order, company_name);

-- ---------------------------------------------------------------------------
-- Daily manual price book. One price per share per day; re-entering the same
-- day corrects it rather than stacking a second row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS us_share_prices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id    uuid NOT NULL REFERENCES us_shares(id) ON DELETE CASCADE,
  price_date  date NOT NULL DEFAULT CURRENT_DATE,
  price       numeric NOT NULL CHECK (price > 0),
  note        text NOT NULL DEFAULT '',
  entered_by  uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (share_id, price_date)
);
CREATE INDEX IF NOT EXISTS us_share_prices_share_date_idx ON us_share_prices (share_id, price_date DESC);

-- Mirror the newest dated price onto the master. Recomputed from the log rather
-- than assigned from NEW, so correcting an older row (or deleting today's)
-- always leaves latest_price equal to the most recent price actually on file.
CREATE OR REPLACE FUNCTION us_sync_latest_price() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_share uuid := coalesce(NEW.share_id, OLD.share_id);
BEGIN
  UPDATE us_shares s
     SET latest_price     = p.price,
         price_date       = p.price_date,
         price_updated_at = now(),
         updated_at       = now()
    FROM (SELECT price, price_date FROM us_share_prices
           WHERE share_id = v_share ORDER BY price_date DESC LIMIT 1) p
   WHERE s.id = v_share;

  -- Every price for this share was removed: the master must not keep a stale one.
  IF NOT EXISTS (SELECT 1 FROM us_share_prices WHERE share_id = v_share) THEN
    UPDATE us_shares SET latest_price = NULL, price_date = NULL,
                         price_updated_at = now(), updated_at = now()
     WHERE id = v_share;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS us_share_prices_sync ON us_share_prices;
CREATE TRIGGER us_share_prices_sync AFTER INSERT OR UPDATE OR DELETE ON us_share_prices
  FOR EACH ROW EXECUTE FUNCTION us_sync_latest_price();

DROP TRIGGER IF EXISTS us_shares_touch ON us_shares;
CREATE TRIGGER us_shares_touch BEFORE UPDATE ON us_shares
  FOR EACH ROW EXECUTE FUNCTION bm_touch_updated_at();
DROP TRIGGER IF EXISTS us_share_prices_touch ON us_share_prices;
CREATE TRIGGER us_share_prices_touch BEFORE UPDATE ON us_share_prices
  FOR EACH ROW EXECUTE FUNCTION bm_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — staff-only tables. Clients and partners never read these directly;
-- they go through the marked-up SECURITY DEFINER projections.
-- ---------------------------------------------------------------------------
ALTER TABLE us_shares       ENABLE ROW LEVEL SECURITY;
ALTER TABLE us_share_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS us_shares_staff_read ON us_shares;
CREATE POLICY us_shares_staff_read ON us_shares FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM nw_employees e WHERE e.auth_user_id = (SELECT auth.uid()) AND e.status = 'active'));

DROP POLICY IF EXISTS us_shares_admin_write ON us_shares;
CREATE POLICY us_shares_admin_write ON us_shares FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

DROP POLICY IF EXISTS us_share_prices_staff_read ON us_share_prices;
CREATE POLICY us_share_prices_staff_read ON us_share_prices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM nw_employees e WHERE e.auth_user_id = (SELECT auth.uid()) AND e.status = 'active'));

DROP POLICY IF EXISTS us_share_prices_admin_write ON us_share_prices;
CREATE POLICY us_share_prices_admin_write ON us_share_prices FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

-- ---------------------------------------------------------------------------
-- Admin write RPCs. The UI could write through RLS directly, but routing the
-- daily price through a function keeps "who entered it" honest (entered_by is
-- server-derived, not client-supplied) and gives one place to validate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION us_set_price(p_share_id uuid, p_price numeric, p_date date DEFAULT CURRENT_DATE, p_note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id(); v_id uuid;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN RAISE EXCEPTION 'Only administrators can enter share prices.'; END IF;
  IF p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'Enter a price greater than zero.'; END IF;
  IF p_date IS NULL OR p_date > CURRENT_DATE THEN RAISE EXCEPTION 'The price date cannot be in the future.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM us_shares WHERE id = p_share_id) THEN RAISE EXCEPTION 'Unknown share.'; END IF;

  INSERT INTO us_share_prices (share_id, price_date, price, note, entered_by)
  VALUES (p_share_id, p_date, p_price, coalesce(p_note,''), v_emp)
  ON CONFLICT (share_id, price_date)
  DO UPDATE SET price = EXCLUDED.price, note = EXCLUDED.note, entered_by = v_emp, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION us_set_price(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION us_set_price(uuid, numeric, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Logo bucket. Public (a company logo is marketing material and is rendered on
-- the partner's shareable offer page, which has no session). The SELECT policy
-- is not decorative — the storage API's upload path needs it, which is what
-- broke employee-avatars three times; see 20260727170000.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('share-logos', 'share-logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read share logos" ON storage.objects;
CREATE POLICY "Authenticated can read share logos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'share-logos');

DROP POLICY IF EXISTS "Admins can upload share logos" ON storage.objects;
CREATE POLICY "Admins can upload share logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'share-logos' AND public.nw_current_emp_is_admin());

DROP POLICY IF EXISTS "Admins can update share logos" ON storage.objects;
CREATE POLICY "Admins can update share logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'share-logos' AND public.nw_current_emp_is_admin())
  WITH CHECK (bucket_id = 'share-logos' AND public.nw_current_emp_is_admin());

DROP POLICY IF EXISTS "Admins can delete share logos" ON storage.objects;
CREATE POLICY "Admins can delete share logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'share-logos' AND public.nw_current_emp_is_admin());

-- ---------------------------------------------------------------------------
-- Seed the five shares we are opening with. No prices: the desk enters those,
-- and an unpriced share is invisible to clients and partners by construction.
-- ---------------------------------------------------------------------------
INSERT INTO us_shares (isin, company_name, short_name, sector, face_value, lot_size, min_qty, display_order)
VALUES
  ('INE721I01024', 'National Stock Exchange of India Limited', 'NSE',        'Financial Services',  1, 1, 1, 10),
  ('INE0DJ201029', 'API Holdings Limited (PharmEasy)',         'PharmEasy',  'Healthcare',          1, 1, 1, 20),
  ('INE312K01010', 'Metropolitan Stock Exchange of India Ltd', 'MSEI',       'Financial Services',  1, 1, 1, 30),
  ('INE143401029', 'Kiranakart Technologies Limited (Zepto)',  'Zepto',      'Consumer / Quick Commerce', 1, 1, 1, 40),
  ('INE03AV01027', 'Imagine Marketing Limited (boAt)',         'boAt',       'Consumer Electronics', 1, 1, 1, 50)
ON CONFLICT (isin) DO NOTHING;
