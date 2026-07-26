-- Verification for 20260727130000_rls_initplan_perf.sql  (NOT a migration — run manually)
--
-- PROOF OF SAFETY: this shows that the ONLY change the migration makes is inserting
-- the `(select )` wrapper. It normalizes every policy's expressions by DELETING the
-- wrapper again, so a policy that was correctly rewritten becomes textually identical
-- to its pre-migration form.
--
-- HOW TO USE
--   1. BEFORE applying, run query A and keep the result (or snapshot into a temp table
--      as shown). 2. Apply the migration. 3. Run query A again. The `normalized_qual`
--      / `normalized_check` columns MUST be unchanged for every policy. Query B does
--      that comparison automatically if you snapshot first.
--
-- Query A — normalized view (wrapper stripped) of every affected table's policies:
select schemaname, tablename, policyname,
       regexp_replace(coalesce(qual,''),       '\(\s*select (auth\.(uid|jwt|role|email)\(\))\s*\)', '\1', 'g') as normalized_qual,
       regexp_replace(coalesce(with_check,''), '\(\s*select (auth\.(uid|jwt|role|email)\(\))\s*\)', '\1', 'g') as normalized_check
from pg_policies
where schemaname='public'
order by tablename, policyname;

-- Query B — automatic before/after diff. Run the FIRST statement BEFORE the migration,
-- then the SECOND block AFTER. It returns 0 rows if nothing but the wrapper changed.
--
-- BEFORE:
--   create temp table _rls_before as
--   select tablename, policyname,
--     regexp_replace(coalesce(qual,''),       '\(\s*select (auth\.(uid|jwt|role|email)\(\))\s*\)', '\1', 'g') as nq,
--     regexp_replace(coalesce(with_check,''), '\(\s*select (auth\.(uid|jwt|role|email)\(\))\s*\)', '\1', 'g') as nc
--   from pg_policies where schemaname='public';
--
-- AFTER (expect 0 rows = identical logic):
--   select b.tablename, b.policyname
--   from _rls_before b
--   join pg_policies p on p.schemaname='public' and p.tablename=b.tablename and p.policyname=b.policyname
--   where b.nq is distinct from
--         regexp_replace(coalesce(p.qual,''),       '\(\s*select (auth\.(uid|jwt|role|email)\(\))\s*\)', '\1', 'g')
--      or b.nc is distinct from
--         regexp_replace(coalesce(p.with_check,''), '\(\s*select (auth\.(uid|jwt|role|email)\(\))\s*\)', '\1', 'g');
