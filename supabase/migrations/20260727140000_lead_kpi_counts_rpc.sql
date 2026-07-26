-- Performance: collapse the Leads list KPI strip from 4 separate COUNT(*) queries
-- (4 scans of nw_leads, 4 round-trips) into ONE single-scan RPC.
--
-- SAFETY
--   * SECURITY INVOKER (default): RLS on nw_leads is enforced as the calling user,
--     so employees still count only leads they own/created and admins count all —
--     identical to the previous per-query behaviour.
--   * The "today" boundary is passed in by the client (browser-local midnight) so
--     the day window is unchanged vs. computing it in the DB's timezone.
--   * STABLE, read-only; pinned search_path.
--   * Filters are byte-identical to the four queries they replace.

create or replace function public.nw_lead_kpi_counts(p_today_start timestamptz)
returns table (total bigint, today bigint, pool bigint, converted bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where is_archived = false)                                  as total,
    count(*) filter (where created_at >= p_today_start)                          as today,
    count(*) filter (where owner_employee_id is null and is_archived = false)    as pool,
    count(*) filter (where status = 'Closed - Converted')                        as converted
  from nw_leads;
$$;

revoke all on function public.nw_lead_kpi_counts(timestamptz) from public;
grant execute on function public.nw_lead_kpi_counts(timestamptz) to authenticated;
