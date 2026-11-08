-- Partner portal: a sourced client's registrar-fed mutual-fund TRANSACTIONS.
--
-- nw_partner_client_transactions reads nw_transactions only, and once funds run
-- on the platform the portal drops in-house MF rows (the registrar is the fund
-- record) — so a fund-only client showed an empty history. A DSA has no RLS
-- access to mf_rta_*, so this mirrors nw_partner_client_mf: SECURITY DEFINER
-- with the same ownership re-check, explicit column projection (no PAN, no
-- folio, no EUIN/ARN), returning the PartnerTransactionRow shape. dsa_price /
-- client_price are null: they are deal economics of our own bond/share deals.
create or replace function public.nw_partner_client_mf_transactions(p_client_id uuid)
returns table (
  txn_id uuid, txn_date date, txn_type text, product_type text, product_name text,
  quantity numeric, amount numeric, dsa_price numeric, client_price numeric
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
  select t.id,
         coalesce(t.trade_date, t.post_date),
         case when t.txn_kind in ('redemption', 'switch_out') then 'sell' else 'buy' end,
         'mutual_fund'::text,
         coalesce(nullif(t.scheme_name, ''), t.scheme_code),
         abs(coalesce(t.units, 0)),
         abs(coalesce(t.amount, 0)),
         null::numeric,
         null::numeric
  from mf_rta_transactions t
  where t.client_id = p_client_id
    and t.txn_kind in ('purchase', 'sip', 'switch_in', 'redemption', 'switch_out')
    and coalesce(t.trade_date, t.post_date) is not null
  order by coalesce(t.trade_date, t.post_date) desc;
end $fn$;

revoke all on function public.nw_partner_client_mf_transactions(uuid) from public, anon;
grant execute on function public.nw_partner_client_mf_transactions(uuid) to authenticated;
