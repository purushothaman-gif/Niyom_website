/*
  # Drop dead modules (junk cleanup)

  Removes three fully-retired clusters that had no live callers. Verified before
  drop: no frontend reads, and no FK from any table outside this set points in.

  1. Unlisted-shares feature (full teardown) — public /unlisted-shares and
     /unlisted-bonds pages + routes are being removed from the frontend in the
     same change; the daily price-updater edge function + cron were already
     deleted. Tables:
       unlisted_shares, secondary_bonds, share_price_history, bond_price_history

  2. HRM module — removed from the app long ago; only stale test rows remained.
     The hrm-auto-clockout edge function + cron were already deleted.
       hrm_announcements, hrm_attendance, hrm_departments, hrm_designations,
       hrm_employee_documents, hrm_employee_profiles, hrm_holidays,
       hrm_leave_balances, hrm_leave_requests, hrm_leave_types, hrm_settings,
       hrm_shifts

  3. Legacy pre-nw_ schema — superseded by the nw_* rebuild. Self-contained
     island (FKs pointed only at each other; is_crm_admin used only by
     crm_users' own RLS policies).
       clients, deals, employees, orders, incentives, crm_users,
       user_profiles, kyc_submissions, share_news
     plus legacy helper functions:
       is_crm_admin(), calculate_monthly_incentive(uuid,date),
       get_employee_metrics(uuid), store_monthly_incentive(uuid,date)

  CASCADE handles the intra-cluster FKs and the RLS policies on crm_users.
*/

-- 1. Unlisted-shares feature tables
DROP TABLE IF EXISTS public.share_price_history CASCADE;
DROP TABLE IF EXISTS public.bond_price_history  CASCADE;
DROP TABLE IF EXISTS public.unlisted_shares     CASCADE;
DROP TABLE IF EXISTS public.secondary_bonds     CASCADE;

-- 2. HRM module tables
DROP TABLE IF EXISTS public.hrm_attendance          CASCADE;
DROP TABLE IF EXISTS public.hrm_announcements       CASCADE;
DROP TABLE IF EXISTS public.hrm_employee_documents  CASCADE;
DROP TABLE IF EXISTS public.hrm_employee_profiles   CASCADE;
DROP TABLE IF EXISTS public.hrm_leave_balances      CASCADE;
DROP TABLE IF EXISTS public.hrm_leave_requests      CASCADE;
DROP TABLE IF EXISTS public.hrm_leave_types         CASCADE;
DROP TABLE IF EXISTS public.hrm_holidays            CASCADE;
DROP TABLE IF EXISTS public.hrm_shifts              CASCADE;
DROP TABLE IF EXISTS public.hrm_designations        CASCADE;
DROP TABLE IF EXISTS public.hrm_departments         CASCADE;
DROP TABLE IF EXISTS public.hrm_settings            CASCADE;

-- 3. Legacy pre-nw_ schema (tables + helper functions; RLS policies drop with crm_users)
DROP FUNCTION IF EXISTS public.calculate_monthly_incentive(emp_id uuid, calc_month date) CASCADE;
DROP FUNCTION IF EXISTS public.get_employee_metrics(employee_uuid uuid) CASCADE;
DROP FUNCTION IF EXISTS public.store_monthly_incentive(emp_id uuid, calc_month date) CASCADE;

DROP TABLE IF EXISTS public.deals            CASCADE;
DROP TABLE IF EXISTS public.orders           CASCADE;
DROP TABLE IF EXISTS public.incentives       CASCADE;
DROP TABLE IF EXISTS public.kyc_submissions  CASCADE;
DROP TABLE IF EXISTS public.share_news       CASCADE;
DROP TABLE IF EXISTS public.user_profiles    CASCADE;
DROP TABLE IF EXISTS public.employees        CASCADE;
DROP TABLE IF EXISTS public.clients          CASCADE;
DROP TABLE IF EXISTS public.crm_users        CASCADE;

DROP FUNCTION IF EXISTS public.is_crm_admin() CASCADE;
