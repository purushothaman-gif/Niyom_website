-- Partner portal: a sourced client's registrar-fed mutual funds.
-- The portfolio RPC reads nw_holdings only, which carries no MF once funds run
-- on the platform, and a DSA has no direct RLS access to mf_rta_*. This mirrors
-- nw_partner_client_portfolio: SECURITY DEFINER with the same ownership re-check,
-- returning the client's registrar MF holdings in the PartnerHoldingRow shape.
-- Registrar gives value but no cost basis, so invested = value and gain = 0.
create or replace function nw_partner_client_mf(p_client_id uuid)
returns table (
  holding_id uuid, product_type text, product_name text,
  quantity numeric, avg_price numeric, invested_amount numeric,
  current_value numeric, gain_loss numeric
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
  select h.id, 'mutual_fund'::text, coalesce(nullif(h.scheme_name, ''), h.scheme_code),
         coalesce(h.units, 0), 0::numeric,
         coalesce(h.rta_value, h.nav_value, 0),
         coalesce(h.rta_value, h.nav_value, 0),
         0::numeric
  from mf_rta_holdings h
  join mf_rta_folios f on f.id = h.folio_id
  where f.client_id = p_client_id
  order by coalesce(h.rta_value, h.nav_value, 0) desc;
end $fn$;

revoke all on function nw_partner_client_mf(uuid) from public, anon;
grant execute on function nw_partner_client_mf(uuid) to authenticated;
