-- Restore "the uploaded sheet IS the current list" on bm_import_prices. A later
-- migration (20260728120000, the overlay-master rework) dropped the sync-active
-- logic, so bonds absent from a new upload stayed active and lingered in the list.
-- Now visible to clients + partners, this matters: after an upload the list must
-- show EXACTLY the bonds in that sheet. Re-add:
--   • ISIN in sheet + already in master → keep mastered data, refresh price,
--     RE-ACTIVATE (a bond that returns comes back automatically).
--   • ISIN in sheet + new              → create (pending → enriched).
--   • ISIN in master but NOT in sheet  → mark INACTIVE (soft-remove; mastered data
--     preserved so a returning bond needs no re-fetch, and existing orders/holdings/
--     pricing/history that reference it stay intact — nothing is hard-deleted).
-- Guarded: the soft-remove only runs when the upload actually contained bonds, so a
-- failed/empty parse can never wipe the live (client-facing) list.

CREATE OR REPLACE FUNCTION public.bm_import_prices(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  emp uuid := nw_current_employee_id();
  r jsonb; v_isin text; v_name text; v_price numeric; v_extra jsonb;
  v_bond bm_bonds%ROWTYPE; v_id uuid;
  created int := 0; updated int := 0; skipped int := 0; removed int := 0;
  new_ids uuid[] := '{}';
  seen_isins text[] := '{}';
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
    seen_isins := array_append(seen_isins, v_isin);

    SELECT * INTO v_bond FROM bm_bonds WHERE isin = v_isin;
    IF FOUND THEN
      UPDATE bm_bonds
         SET latest_price = COALESCE(v_price, latest_price),
             price_updated_at = now(), modified_by = emp,
             active_status = 'active',                       -- back in the current list
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

  -- Soft-remove anything not in this upload (only when the upload had bonds).
  IF array_length(seen_isins, 1) > 0 THEN
    WITH deact AS (
      UPDATE bm_bonds SET active_status = 'inactive', updated_at = now()
       WHERE NOT (isin = ANY(seen_isins)) AND active_status = 'active'
      RETURNING 1
    )
    SELECT count(*) INTO removed FROM deact;
  END IF;

  RETURN jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped,
                            'removed', removed, 'new_bond_ids', to_jsonb(new_ids));
END;
$function$;
