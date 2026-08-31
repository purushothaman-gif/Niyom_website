/*
  # Lead Management — Partner vs Client datasets

  Split leads into two datasets the team maintains separately. `lead_category`
  ('partner' | 'client') is added with DEFAULT 'partner', which backfills every
  existing row to Partner (there is no Client data yet). Only admins may
  reclassify a lead (enforced in the guard trigger); the change is audited; and
  the dashboard aggregation takes an optional category scope.

  Applied to the live DB via the Supabase MCP (histories diverged, db push
  blocked); this file records it. Nothing here removes or narrows an existing
  value — purely additive.
*/

-- 1. Column + indexes ---------------------------------------------------------
ALTER TABLE nw_leads
  ADD COLUMN IF NOT EXISTS lead_category text NOT NULL DEFAULT 'partner'
  CHECK (lead_category IN ('partner','client'));

CREATE INDEX IF NOT EXISTS idx_nw_leads_owner_category   ON nw_leads(owner_employee_id, lead_category);
CREATE INDEX IF NOT EXISTS idx_nw_leads_category_archived ON nw_leads(lead_category, is_archived);

-- 2. Guard: non-admins may not change the category (they pick it once on create)
CREATE OR REPLACE FUNCTION nw_leads_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF nw_current_emp_is_admin() THEN RETURN NEW; END IF;
  IF OLD.is_locked THEN
    RAISE EXCEPTION 'This lead is locked and can only be edited by an administrator.';
  END IF;
  IF NEW.owner_employee_id IS DISTINCT FROM OLD.owner_employee_id
     OR NEW.created_by_employee_id IS DISTINCT FROM OLD.created_by_employee_id
     OR NEW.lead_origin IS DISTINCT FROM OLD.lead_origin
     OR NEW.lead_category IS DISTINCT FROM OLD.lead_category
     OR NEW.is_locked IS DISTINCT FROM OLD.is_locked THEN
    RAISE EXCEPTION 'You are not allowed to change ownership, origin, category, or lock state of a lead.';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Audit: record category changes -------------------------------------------
CREATE OR REPLACE FUNCTION nw_leads_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp uuid := nw_current_employee_id();
  oj jsonb := to_jsonb(OLD);
  nj jsonb := to_jsonb(NEW);
  col text;
  audited text[] := ARRAY['lead_name','mobile','alternate_number','email','pan','address',
    'city','state','occupation','company_name','age','annual_income','investment_capacity',
    'interested_product','lead_source','campaign','priority','remarks','status',
    'owner_employee_id','lead_category','is_locked','is_archived'];
BEGIN
  FOREACH col IN ARRAY audited LOOP
    IF (oj->>col) IS DISTINCT FROM (nj->>col) THEN
      INSERT INTO nw_lead_audit(lead_id, employee_id, field_name, old_value, new_value)
      VALUES (NEW.id, emp, col, oj->>col, nj->>col);
    END IF;
  END LOOP;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO nw_lead_status_history(lead_id, employee_id, from_status, to_status)
    VALUES (NEW.id, emp, OLD.status, NEW.status);
  END IF;
  RETURN NULL;
END;
$$;

-- 4. Dashboard: optional category scope ---------------------------------------
DROP FUNCTION IF EXISTS nw_lead_dashboard();
CREATE OR REPLACE FUNCTION nw_lead_dashboard(p_category text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := nw_current_employee_id();
  adm boolean := nw_current_emp_is_admin();
  today_d date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  result jsonb;
BEGIN
  IF me IS NULL THEN RETURN '{}'::jsonb; END IF;

  WITH scoped AS (
    SELECT * FROM nw_leads
     WHERE (adm OR owner_employee_id = me OR created_by_employee_id = me)
       AND (p_category IS NULL OR lead_category = p_category)
  ),
  totals AS (
    SELECT
      count(*) FILTER (WHERE NOT is_archived)                              AS active,
      count(*) FILTER (WHERE created_at::date = today_d)                   AS today,
      count(*) FILTER (WHERE owner_employee_id IS NOT NULL AND NOT is_archived) AS assigned,
      count(*) FILTER (WHERE status = 'Interested')                        AS interested,
      count(*) FILTER (WHERE status = 'Closed - Converted')               AS converted,
      count(*) FILTER (WHERE status IN ('Lost','Not Interested','Closed - Rejected')) AS lost,
      count(*)                                                             AS all_leads
    FROM scoped
  ),
  fu AS (
    SELECT
      count(*) FILTER (WHERE f.status = 'pending' AND (f.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date = today_d) AS today_cnt,
      count(*) FILTER (WHERE f.status = 'pending' AND f.scheduled_at < now())  AS overdue_cnt,
      count(*) FILTER (WHERE f.status = 'missed')                              AS missed_cnt
    FROM nw_lead_followups f WHERE f.lead_id IN (SELECT id FROM scoped)
  ),
  calls AS (
    SELECT count(*) FILTER (WHERE c.comm_type = 'call' AND c.created_at::date = today_d) AS today_calls
    FROM nw_lead_communications c WHERE c.lead_id IN (SELECT id FROM scoped)
  )
  SELECT jsonb_build_object(
    'scope', CASE WHEN adm THEN 'admin' ELSE 'employee' END,
    'totals', (SELECT jsonb_build_object(
        'active', active, 'today', today, 'assigned', assigned, 'interested', interested,
        'converted', converted, 'lost', lost, 'all', all_leads,
        'conversion_rate', CASE WHEN all_leads > 0 THEN round(converted::numeric*100/all_leads,1) ELSE 0 END
      ) FROM totals),
    'followups', (SELECT jsonb_build_object('today', today_cnt, 'overdue', overdue_cnt, 'missed', missed_cnt) FROM fu),
    'today_calls', (SELECT today_calls FROM calls),
    'by_status', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', status, 'count', c) ORDER BY c DESC), '[]')
                    FROM (SELECT status, count(*) c FROM scoped WHERE NOT is_archived GROUP BY status) s),
    'by_source', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', COALESCE(NULLIF(lead_source,''),'Unknown'), 'count', c) ORDER BY c DESC), '[]')
                    FROM (SELECT lead_source, count(*) c FROM scoped GROUP BY lead_source ORDER BY count(*) DESC LIMIT 8) s),
    'by_product', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', COALESCE(NULLIF(interested_product,''),'Unknown'), 'count', c) ORDER BY c DESC), '[]')
                    FROM (SELECT interested_product, count(*) c FROM scoped GROUP BY interested_product ORDER BY count(*) DESC LIMIT 8) s),
    'by_priority', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', priority, 'count', c)), '[]')
                    FROM (SELECT priority, count(*) c FROM scoped GROUP BY priority) s),
    'by_origin', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', lead_origin, 'count', c)), '[]')
                    FROM (SELECT lead_origin, count(*) c FROM scoped GROUP BY lead_origin) s),
    'funnel', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', lbl, 'count', c) ORDER BY ord), '[]')
                 FROM (
                   SELECT 1 ord, 'New/Assigned' lbl, count(*) FILTER (WHERE status IN ('New','Assigned')) c FROM scoped
                   UNION ALL SELECT 2, 'Contacted', count(*) FILTER (WHERE status IN ('Attempted','Connected','Follow-up','Call Back Later')) FROM scoped
                   UNION ALL SELECT 3, 'Interested', count(*) FILTER (WHERE status IN ('Interested','Meeting Scheduled')) FROM scoped
                   UNION ALL SELECT 4, 'In Process', count(*) FILTER (WHERE status IN ('Documentation Pending','KYC Pending','Investment Under Process','Waiting for Client')) FROM scoped
                   UNION ALL SELECT 5, 'Converted', count(*) FILTER (WHERE status = 'Closed - Converted') FROM scoped
                 ) s),
    'monthly_trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', to_char(m,'Mon'), 'count', COALESCE(c,0)) ORDER BY m), '[]')
                        FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
                        LEFT JOIN (SELECT date_trunc('month', created_at) mm, count(*) c FROM scoped GROUP BY 1) t ON t.mm = m),
    'self_vs_assigned', (SELECT jsonb_build_object(
        'self', count(*) FILTER (WHERE lead_origin = 'employee_manual'),
        'assigned', count(*) FILTER (WHERE lead_origin IN ('admin_manual','admin_upload'))) FROM scoped),
    'daily_calls', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', to_char(dd,'Dy'), 'count', COALESCE(c,0)) ORDER BY dd), '[]')
                      FROM (SELECT (today_d - g)::date dd FROM generate_series(0,6) g) days
                      LEFT JOIN (SELECT c.created_at::date cdate, count(*) c FROM nw_lead_communications c
                                  WHERE c.comm_type='call' AND c.lead_id IN (SELECT id FROM scoped) GROUP BY 1) t ON t.cdate = days.dd),
    'by_employee', (CASE WHEN adm THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('label', name, 'total', tot, 'converted', conv) ORDER BY tot DESC), '[]')
          FROM (SELECT e.full_name name, count(l.*) tot, count(*) FILTER (WHERE l.status='Closed - Converted') conv
                  FROM nw_employees e JOIN nw_leads l ON l.owner_employee_id = e.id
                   AND (p_category IS NULL OR l.lead_category = p_category)
                 GROUP BY e.full_name ORDER BY count(l.*) DESC LIMIT 10) s
      ) ELSE '[]'::jsonb END)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION nw_lead_dashboard(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION nw_lead_dashboard(text) TO authenticated;

-- 5. KPI-strip counts: optional category scope --------------------------------
DROP FUNCTION IF EXISTS nw_lead_kpi_counts(timestamptz);
CREATE OR REPLACE FUNCTION nw_lead_kpi_counts(p_today_start timestamptz, p_category text DEFAULT NULL)
RETURNS TABLE(total bigint, today bigint, pool bigint, converted bigint)
LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  select
    count(*) filter (where is_archived = false)                               as total,
    count(*) filter (where created_at >= p_today_start)                       as today,
    count(*) filter (where owner_employee_id is null and is_archived = false) as pool,
    count(*) filter (where status = 'Closed - Converted')                     as converted
  from nw_leads
  where (p_category is null or lead_category = p_category);
$function$;
GRANT EXECUTE ON FUNCTION nw_lead_kpi_counts(timestamptz, text) TO authenticated;
