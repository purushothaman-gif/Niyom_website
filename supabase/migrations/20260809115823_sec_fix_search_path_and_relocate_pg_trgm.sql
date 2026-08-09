-- Two advisor items that are really one problem: pg_trgm was installed into
-- `public`, which both trips extension_in_public AND dumps ~31 extension-owned
-- functions into public alongside our own.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on OUR functions that lacked it (the advisor's 14).
-- ---------------------------------------------------------------------------
-- A function with no search_path resolves unqualified names against whatever
-- the caller's path happens to be; for a SECURITY DEFINER function that is a
-- privilege-escalation route (attacker-controlled schema shadowing a table).
--
-- `public, extensions` rather than `''`: these bodies reference tables
-- unqualified, so an empty path would break them outright. It also matches the
-- project's own `extra_search_path = ["public", "extensions"]` in config.toml,
-- and stays correct after pg_trgm relocates below.
--
-- Extension-owned functions are excluded via pg_depend deptype='e'. Those
-- belong to pg_trgm, not to us; ALTERing them would be reverted on extension
-- upgrade and is not ours to do.
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
      ))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'pinned search_path on % function(s)', n;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Relocate pg_trgm out of public.
-- ---------------------------------------------------------------------------
-- Verified safe first: nothing in the database (function, RLS policy or view)
-- and nothing in the application uses pg_trgm explicitly -- no similarity(),
-- word_similarity, show_trgm, set_limit, % or <% anywhere. The ten GIN indexes
-- exist solely to accelerate ILIKE, and an index binds its operator class by
-- OID, so the opclass moving schema does not invalidate them.
--
-- Confirmed after applying: pg_trgm in `extensions`, all 10 trgm indexes
-- present and valid, and the plan for `lead_name ILIKE '%ram%'` is byte-for-byte
-- the same Bitmap Index Scan on idx_nw_leads_name_trgm as before.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
