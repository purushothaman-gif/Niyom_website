-- Performance: fix 65 RLS policies flagged by Supabase advisor `auth_rls_initplan`.
--
-- WHAT THIS DOES
--   Wraps bare `auth.uid()` / `auth.jwt()` / `auth.role()` / `auth.email()` calls
--   inside RLS USING / WITH CHECK expressions as `(select auth.<fn>())`.
--
-- WHY IT IS SAFE (no data or visibility change)
--   `(select auth.uid())` returns the IDENTICAL value as `auth.uid()`. The only
--   difference is evaluation: Postgres treats the sub-select as an InitPlan and
--   evaluates it ONCE per query instead of ONCE PER ROW. Same rows in, same rows
--   out — only faster. No table data is read or written. Every other part of each
--   policy (employee/role/status joins, ownership checks) is left byte-for-byte
--   unchanged.
--
-- IDEMPOTENT
--   Only policies that still contain an UNWRAPPED auth.* call are rewritten, so
--   re-running is a no-op. The rewrite is generated from the live catalog at apply
--   time (pg_policies), so it can never drift from the current definitions.
--
-- REVIEW AID
--   Run supabase/migrations/_verify_rls_initplan.sql BEFORE and AFTER applying this
--   to prove that, after stripping the `(select )` wrapper, every policy expression
--   is textually identical to what it was before.

do $$
declare
  r record;
  new_qual  text;
  new_check text;
  stmt      text;
  n         int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual       ~ 'auth\.(uid|jwt|role|email)\(\)' and qual       !~ '\(\s*select auth\.')
        or (with_check ~ 'auth\.(uid|jwt|role|email)\(\)' and with_check !~ '\(\s*select auth\.')
      )
  loop
    -- Wrap each bare auth.<fn>() that is NOT already inside `(select ...)`.
    new_qual  := regexp_replace(r.qual,       '(?<!select )(auth\.(uid|jwt|role|email)\(\))', '(select \1)', 'g');
    new_check := regexp_replace(r.with_check, '(?<!select )(auth\.(uid|jwt|role|email)\(\))', '(select \1)', 'g');

    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      stmt := stmt || ' using (' || new_qual || ')';
    end if;
    if r.with_check is not null then
      stmt := stmt || ' with check (' || new_check || ')';
    end if;

    execute stmt;
    n := n + 1;
  end loop;

  raise notice 'rls_initplan_perf: rewrote % policies', n;
end $$;
