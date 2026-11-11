-- Partner portal: a sourced client's registrar-fed SIP / STP / SWP schedule.
--
-- The client portal reads mf_rta_sips directly under its own RLS; a DSA has no
-- direct RLS access to mf_rta_*, so (exactly like nw_partner_client_mf and
-- nw_partner_client_mf_transactions) this is SECURITY DEFINER with the same
-- ownership re-check and an explicit column projection that drops PAN, folio,
-- EUIN and sub-ARN. sip_day is text on purpose: the registrar's PERIOD_DAY can
-- carry composite mandate days, not a single integer.
create or replace function public.nw_partner_client_mf_sips(p_client_id uuid)
returns table (
  sip_id uuid, scheme_name text, txn_type text, amount numeric,
  frequency text, sip_day text, status text, from_date date, to_date date
)
language plpgsql stable security definer set search_path = public as $fn$
declare v_dsa uuid;
begin
  v_dsa := nw_current_dsa_id();
  if v_dsa is null then raise exception 'Partner access required'; end if;

  if not exists (
    select 1 from nw_clients c
    where c.id = p_client_id and c.dsa_id = v_dsa and c.sourced_via = 'dsa'
  ) then
    return;
  end if;

  return query
  select s.id,
         coalesce(nullif(s.scheme_name, ''), s.scheme_code),
         s.txn_type,
         s.amount,
         s.frequency,
         s.sip_day,
         s.status,
         s.from_date,
         s.to_date
  from mf_rta_sips s
  where s.client_id = p_client_id
  order by (s.status = 'active') desc, s.from_date desc nulls last;
end $fn$;

revoke all on function public.nw_partner_client_mf_sips(uuid) from public, anon;
grant execute on function public.nw_partner_client_mf_sips(uuid) to authenticated;
