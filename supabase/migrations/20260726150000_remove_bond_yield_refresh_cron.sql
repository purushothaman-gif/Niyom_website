/*
  # Remove the bond-yield-refresh cron (unwanted)

  Bond yields are computed event-driven on each admin bond-list upload, not on a
  timer: BondImport.tsx runs bm_import_prices (new list replaces old — bonds not
  in the upload are set inactive), then enrichPendingLoop + recomputeAllActive
  (both call the bond-enrich edge fn as the logged-in admin). The every-10-min
  `bond-yield-refresh` cron was redundant AND broken (null-GUC url bug, 312 failed
  runs). Remove it and its trigger function.

  bond-enrich itself is unchanged — it stays verify_jwt=true and is called from
  the CRM with the staff user's JWT.
*/

DO $$
BEGIN
  PERFORM cron.unschedule('bond-yield-refresh');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DROP FUNCTION IF EXISTS public.trigger_bond_yield_refresh();
