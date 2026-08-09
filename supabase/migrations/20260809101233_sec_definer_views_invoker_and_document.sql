-- The two SECURITY DEFINER views flagged by the advisor. They look alike to the
-- linter and need opposite treatment, so both outcomes are recorded here.

-- ---------------------------------------------------------------------------
-- 1. nw_orphaned_holdings -> convert to security_invoker. Genuine defect.
-- ---------------------------------------------------------------------------
-- Ran as the view owner, so RLS on nw_holdings/nw_clients was bypassed, and the
-- definition carries no caller check of its own. Combined with the `anon` grant
-- (revoked in the previous migration) this exposed client full_name + pan
-- unauthenticated.
--
-- Safe to flip: nothing in the application reads this view (only migrations, as
-- a manual reconciliation query), and nw_holdings + nw_clients both already
-- carry correct SELECT policies -- staff see their own clients, admins see all,
-- clients see themselves. Under invoker semantics the view inherits exactly
-- that, which is the scoping an audit view should have had from the start.
-- Querying it as postgres (SQL editor) still works: the owner bypasses RLS.
ALTER VIEW public.nw_orphaned_holdings SET (security_invoker = true);

COMMENT ON VIEW public.nw_orphaned_holdings IS
  'Audit view: holdings with no matching buy transaction. security_invoker=true '
  'so it is scoped by the caller''s RLS. Do not grant to anon -- it exposes '
  'client full_name and pan.';

-- ---------------------------------------------------------------------------
-- 2. bm_bonds_public -> stays SECURITY DEFINER, deliberately. Not a defect.
-- ---------------------------------------------------------------------------
-- This view exists to BROADEN read access, not to escape RLS. bm_bonds and
-- bm_issuers are admin-only (bm_bonds_admin_all / bm_issuers_admin_all), while
-- the whole CRM bond module reads the catalog as ordinary staff. The view is a
-- column-filtered projection: 60 of the base table's 65 columns, omitting
-- landing_cost, which is admin-only.
--
-- Converting it to security_invoker would take one of two bad options:
--   * leave RLS as-is -> every non-admin employee loses the bond catalogue; or
--   * add a staff SELECT policy on bm_bonds -> landing_cost leaks to all staff,
--     because RLS is row-level and cannot hide a column, and a column GRANT
--     cannot separate admins from staff (both are `authenticated`).
-- A definer view is the correct tool for a column-filtered projection. Its
-- access control is the WHERE clause below, which requires an active employee;
-- auth.uid() still resolves to the CALLER inside a definer view, so the gate
-- holds and anon (uid NULL) matches no rows.
--
-- What was wrong is only that `anon` held the grant at all.
REVOKE ALL ON public.bm_bonds_public FROM anon;

COMMENT ON VIEW public.bm_bonds_public IS
  'Client-safe projection of bm_bonds (omits admin-only landing_cost). '
  'INTENTIONALLY security_invoker=false: bm_bonds is admin-only via RLS and '
  'this view is how non-admin staff read the catalogue. Do not "fix" the '
  'advisor warning by flipping it -- that either breaks the catalogue for '
  'staff or leaks landing_cost. Access control is the active-employee check in '
  'the view definition.';
