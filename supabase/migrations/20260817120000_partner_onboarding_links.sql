-- Partner self-onboarding referral links (applied to the hosted DB via CLI
-- 2026-08-17). Reuses mkt_referral_links with a new kind='partner', kept
-- distinct from the client 'employee'/'company'/'dsa' kinds. Per-employee links
-- map a self-onboarding partner under that RM; the company-direct link (no
-- employee) maps to the house account.
alter table mkt_referral_links drop constraint mkt_referral_links_kind_check;
alter table mkt_referral_links add constraint mkt_referral_links_kind_check
  check (kind = any (array['employee','company','dsa','partner']));

alter table mkt_referral_links drop constraint mkt_referral_links_owner_check;
alter table mkt_referral_links add constraint mkt_referral_links_owner_check check (
     ((kind = 'company')  and employee_id is null     and dsa_id is null)
  or ((kind = 'employee') and employee_id is not null and dsa_id is null)
  or ((kind = 'dsa')      and employee_id is null     and dsa_id is not null)
  or ((kind = 'partner')  and dsa_id is null)
);

-- Self-healing: mints any missing partner links (company-direct + one per active
-- employee), so new employees always have one. Called by DSA Management on load.
create or replace function nw_ensure_partner_ref_links()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if nw_current_employee_id() is null then return; end if;
  insert into mkt_referral_links (employee_id, ref_code, kind, label, active)
  select null, 'p' || substr(replace(gen_random_uuid()::text,'-',''),1,15),
         'partner', 'Company Direct — Partner Onboarding', true
  where not exists (select 1 from mkt_referral_links where kind='partner' and employee_id is null);
  insert into mkt_referral_links (employee_id, ref_code, kind, label, active)
  select e.id, 'p' || substr(replace(gen_random_uuid()::text,'-',''),1,15),
         'partner', 'Partner Onboarding — ' || e.full_name, true
  from nw_employees e
  where e.status='active'
    and not exists (select 1 from mkt_referral_links r where r.kind='partner' and r.employee_id=e.id);
end; $$;
revoke execute on function nw_ensure_partner_ref_links() from public;
grant execute on function nw_ensure_partner_ref_links() to authenticated;
-- (initial mint performed inline via CLI)

-- Let employees read their OWN partner link (the select policy previously only
-- covered kind='employee').
drop policy mkt_referral_links_select on mkt_referral_links;
create policy mkt_referral_links_select on mkt_referral_links for select to authenticated
using (
  (select nw_current_emp_is_admin())
  or (kind in ('employee','partner') and employee_id = (select nw_current_employee_id()))
  or (kind = 'dsa' and dsa_id = (select nw_current_dsa_id()))
);
