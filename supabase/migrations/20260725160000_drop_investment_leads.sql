/*
  # Remove the public "Invest Now" lead-capture system

  The four public "Invest Now" lead forms (Mutual Funds / Primary Bonds /
  Fixed Deposits / Insurance), their frontend pages, and their routes were
  removed. This migration drops the backing table and its rate-limit trigger
  function.

  IMPORTANT: This is UNRELATED to the CRM Lead Management module, which uses the
  separate `nw_leads` / `nw_lead_*` tables. Those are NOT touched.

  A backup of the table's rows (3 internal test submissions) was saved to
  `Niyom/backups/investment_leads_backup_2026-07-25.json` before this drop.

  ## Changes
    - DROP TABLE `investment_leads` (CASCADE also removes its RLS policies,
      indexes, and the `lead_rate_limit_trigger`).
    - DROP FUNCTION `check_lead_rate_limit()` (the trigger's function, not
      removed by the table CASCADE).
*/

DROP TABLE IF EXISTS public.investment_leads CASCADE;
DROP FUNCTION IF EXISTS public.check_lead_rate_limit() CASCADE;
