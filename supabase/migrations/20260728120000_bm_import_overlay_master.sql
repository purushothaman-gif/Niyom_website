/*
  # Server-side overlay of the sheet's fields onto the master (durable fix)

  Until now, the daily importer (`bm_import_prices`) only stashed the sheet's extra
  columns into `bm_bonds.import_raw`. Promoting those staged values onto the VISIBLE
  master columns (coupon_rate, maturity_date, rating, …) was done ONLY by the
  browser-side `remasterAllActive` loop after upload. If that loop didn't finish
  (tab closed, navigated away, or an edge-function invocation timed out mid-run),
  the trailing bonds kept empty master columns even though import_raw was full —
  showing as blank fields, "Data quality 6%", and "Needs Review".

  This makes the overlay happen SERVER-SIDE inside the import RPC, so master
  population no longer depends on the browser completing anything. It mirrors the
  edge function's remaster logic exactly:
    - the sheet is the primary source for its fields (sheet wins),
    - LOCKED fields (bm_field_provenance.is_locked) are never overwritten,
    - fields the sheet doesn't carry are preserved (provider/manual values kept),
    - data_quality_score + verification_status re-scored with the same
      16-field / 4-required sets the edge function uses.

  Analytics (yields, coupon/cashflow schedules) are still computed by the Deno
  edge function; this only promotes the master FACTS so they display immediately.
*/

CREATE OR REPLACE FUNCTION bm_overlay_from_import_raw(p_bond_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b       bm_bonds%ROWTYPE;
  raw     jsonb;
  locked  text[];
  -- effective (post-overlay) values: sheet wins unless the field is locked
  ev_coupon_rate       numeric;
  ev_coupon_type       text;
  ev_coupon_frequency  text;
  ev_ipd               text;
  ev_maturity          date;
  ev_face              numeric;
  ev_rating            text;
  ev_rating_agency     text;
  ev_seniority         text;
  ev_security_type     text;
  ev_tax_status        text;
  ev_prs               text;
  ev_redemption        jsonb;
  present              int;
  score                int;
  status               text;
BEGIN
  SELECT * INTO b FROM bm_bonds WHERE id = p_bond_id;
  IF NOT FOUND THEN RETURN; END IF;
  raw := COALESCE(b.import_raw, '{}'::jsonb);
  IF raw = '{}'::jsonb THEN RETURN; END IF;

  SELECT COALESCE(array_agg(field_name), '{}') INTO locked
    FROM bm_field_provenance WHERE bond_id = p_bond_id AND is_locked;

  ev_coupon_rate      := CASE WHEN 'coupon_rate'      = ANY(locked) THEN b.coupon_rate      ELSE COALESCE(NULLIF(raw->>'coupon_rate','')::numeric, b.coupon_rate) END;
  ev_coupon_type      := CASE WHEN 'coupon_type'      = ANY(locked) THEN b.coupon_type      ELSE COALESCE(NULLIF(raw->>'coupon_type',''),           b.coupon_type) END;
  ev_coupon_frequency := CASE WHEN 'coupon_frequency' = ANY(locked) THEN b.coupon_frequency ELSE COALESCE(NULLIF(raw->>'coupon_frequency',''),      b.coupon_frequency) END;
  ev_ipd              := CASE WHEN 'interest_payment_dates' = ANY(locked) THEN b.interest_payment_dates ELSE COALESCE(NULLIF(raw->>'interest_payment_dates',''), b.interest_payment_dates) END;
  ev_maturity         := CASE WHEN 'maturity_date'    = ANY(locked) THEN b.maturity_date    ELSE COALESCE(NULLIF(raw->>'maturity_date','')::date, b.maturity_date) END;
  ev_face             := CASE WHEN 'face_value'       = ANY(locked) THEN b.face_value       ELSE COALESCE(NULLIF(raw->>'face_value','')::numeric, b.face_value) END;
  ev_rating           := CASE WHEN 'rating'           = ANY(locked) THEN b.rating           ELSE COALESCE(NULLIF(raw->>'rating',''),               b.rating) END;
  ev_rating_agency    := CASE WHEN 'rating_agency'    = ANY(locked) THEN b.rating_agency    ELSE COALESCE(NULLIF(raw->>'rating_agency',''),        b.rating_agency) END;
  ev_seniority        := CASE WHEN 'seniority'        = ANY(locked) THEN b.seniority        ELSE COALESCE(NULLIF(raw->>'seniority',''),            b.seniority) END;
  ev_security_type    := CASE WHEN 'security_type'    = ANY(locked) THEN b.security_type    ELSE COALESCE(NULLIF(raw->>'security_type',''),        b.security_type) END;
  ev_tax_status       := CASE WHEN 'tax_status'       = ANY(locked) THEN b.tax_status       ELSE COALESCE(NULLIF(raw->>'tax_status',''),           b.tax_status) END;
  ev_prs              := CASE WHEN 'principal_repayment_structure' = ANY(locked) THEN b.principal_repayment_structure ELSE COALESCE(NULLIF(raw->>'principal_repayment_structure',''), b.principal_repayment_structure) END;

  ev_redemption := CASE
    WHEN 'redemption_schedule' = ANY(locked) THEN b.redemption_schedule
    WHEN jsonb_typeof(raw->'redemption_schedule') = 'array'
         AND jsonb_array_length(raw->'redemption_schedule') > 0 THEN raw->'redemption_schedule'
    ELSE b.redemption_schedule
  END;

  -- data-quality score over the same 16 QUALITY_FIELDS the edge fn uses. issuer_name
  -- is only ever populated by a live provider merge, so (matching remaster) it is
  -- not counted here; issue_date / secured / exchange_listed are preserved as-is.
  present :=
      (ev_coupon_rate IS NOT NULL)::int
    + (COALESCE(ev_coupon_type,'')      <> '')::int
    + (COALESCE(ev_coupon_frequency,'') <> '')::int
    + (COALESCE(ev_ipd,'')              <> '')::int
    + (ev_maturity IS NOT NULL)::int
    + (b.issue_date IS NOT NULL)::int
    + (ev_face IS NOT NULL)::int
    + (COALESCE(ev_rating,'')           <> '')::int
    + (COALESCE(ev_rating_agency,'')    <> '')::int
    + (COALESCE(ev_seniority,'')        <> '')::int
    + (COALESCE(ev_security_type,'')    <> '')::int
    + (b.secured IS NOT NULL)::int
    + (COALESCE(ev_tax_status,'')       <> '')::int
    + (COALESCE(b.exchange_listed,'')   <> '')::int
    + (COALESCE(ev_prs,'')              <> '')::int;
  score  := round(100.0 * present / 16.0)::int;
  status := CASE
    WHEN ev_coupon_rate IS NOT NULL
     AND COALESCE(ev_coupon_frequency,'') <> ''
     AND ev_maturity IS NOT NULL
     AND ev_face IS NOT NULL
    THEN 'verified' ELSE 'needs_review' END;

  UPDATE bm_bonds SET
    coupon_rate                   = ev_coupon_rate,
    coupon_type                   = ev_coupon_type,
    coupon_frequency              = ev_coupon_frequency,
    interest_payment_dates        = ev_ipd,
    maturity_date                 = ev_maturity,
    face_value                    = ev_face,
    rating                        = ev_rating,
    rating_agency                 = ev_rating_agency,
    seniority                     = ev_seniority,
    security_type                 = ev_security_type,
    tax_status                    = ev_tax_status,
    principal_repayment_structure = ev_prs,
    redemption_schedule           = ev_redemption,
    data_quality_score            = score,
    verification_status           = status,
    enriched_at                   = now(),
    updated_at                    = now()
  WHERE id = p_bond_id;
END;
$$;

REVOKE ALL ON FUNCTION bm_overlay_from_import_raw(uuid) FROM PUBLIC;

-- Wire the overlay into the daily importer: whenever a row carries sheet extras,
-- promote them to the master immediately (create AND update paths).
CREATE OR REPLACE FUNCTION bm_import_prices(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := nw_current_employee_id();
  r jsonb; v_isin text; v_name text; v_price numeric; v_extra jsonb;
  v_bond bm_bonds%ROWTYPE; v_id uuid;
  created int := 0; updated int := 0; skipped int := 0;
  new_ids uuid[] := '{}';
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can import the bond price file.';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
    v_isin  := upper(trim(COALESCE(r->>'isin','')));
    v_name  := trim(COALESCE(r->>'bond_name',''));
    v_price := NULLIF(trim(COALESCE(r->>'price','')), '')::numeric;
    v_extra := COALESCE(r->'extra', '{}'::jsonb);
    IF v_isin !~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$' THEN skipped := skipped + 1; CONTINUE; END IF;

    SELECT * INTO v_bond FROM bm_bonds WHERE isin = v_isin;
    IF FOUND THEN
      UPDATE bm_bonds
         SET latest_price = COALESCE(v_price, latest_price),
             price_updated_at = now(), modified_by = emp,
             import_raw = CASE WHEN v_extra <> '{}'::jsonb THEN v_extra ELSE import_raw END,
             extracted_name = CASE WHEN extracted_name = '' THEN v_name ELSE extracted_name END
       WHERE id = v_bond.id;
      IF v_price IS NOT NULL THEN
        INSERT INTO bm_price_history(bond_id, isin, price, as_of, source)
          VALUES (v_bond.id, v_isin, v_price, current_date, 'excel_upload')
          ON CONFLICT (bond_id, as_of) DO UPDATE SET price = EXCLUDED.price;
      END IF;
      IF v_extra <> '{}'::jsonb THEN PERFORM bm_overlay_from_import_raw(v_bond.id); END IF;
      updated := updated + 1;
    ELSE
      INSERT INTO bm_bonds(isin, bond_name, extracted_name, latest_price, price_updated_at,
                           import_raw, verification_status, created_by, modified_by)
        VALUES (v_isin, v_name, v_name, v_price, now(), v_extra, 'pending', emp, emp)
        RETURNING id INTO v_id;
      IF v_price IS NOT NULL THEN
        INSERT INTO bm_price_history(bond_id, isin, price, as_of, source)
          VALUES (v_id, v_isin, v_price, current_date, 'excel_upload');
      END IF;
      IF v_extra <> '{}'::jsonb THEN PERFORM bm_overlay_from_import_raw(v_id); END IF;
      new_ids := array_append(new_ids, v_id);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', created, 'updated', updated,
                            'skipped', skipped, 'new_bond_ids', to_jsonb(new_ids));
END;
$$;
