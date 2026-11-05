-- =============================================================================
-- Watchlist (approved 2026-11-06)
--
-- Clients star bonds / funds / unlisted shares to come back to; partners keep a
-- shortlist of offers to pitch. One table, one owner per row: a client OR a
-- partner, never both. The owner is filled from the caller's own session by
-- column defaults (nw_current_client_id / nw_current_dsa_id), so the app never
-- sends — and cannot spoof — an owner id; RLS then checks it again.
--
-- item_ref is the product's own key: bm_bonds.id / us_shares.id (uuid text)
-- or the AMFI scheme code for a fund. No FK to the catalogues on purpose: a
-- bond that is withdrawn or a scheme that closes simply stops rendering in the
-- watchlist rather than blocking the catalogue change.
-- =============================================================================

create table if not exists public.nw_watchlist (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references public.nw_clients(id) on delete cascade default public.nw_current_client_id(),
  dsa_id     uuid references public.nw_dsa(id)     on delete cascade default public.nw_current_dsa_id(),
  item_type  text not null check (item_type in ('bond', 'share', 'fund')),
  item_ref   text not null check (length(item_ref) between 1 and 64),
  created_at timestamptz not null default now(),
  constraint nw_watchlist_one_owner check (num_nonnulls(client_id, dsa_id) = 1)
);

create unique index if not exists nw_watchlist_client_item
  on public.nw_watchlist (client_id, item_type, item_ref) where client_id is not null;
create unique index if not exists nw_watchlist_dsa_item
  on public.nw_watchlist (dsa_id, item_type, item_ref) where dsa_id is not null;

alter table public.nw_watchlist enable row level security;

-- Own rows only. (select …) wrappers keep the helper to one call per query.
create policy nw_watchlist_select_own on public.nw_watchlist
  for select to authenticated
  using (
    (client_id is not null and client_id = (select public.nw_current_client_id()))
    or (dsa_id is not null and dsa_id = (select public.nw_current_dsa_id()))
  );

create policy nw_watchlist_insert_own on public.nw_watchlist
  for insert to authenticated
  with check (
    (client_id is not null and client_id = (select public.nw_current_client_id()) and dsa_id is null)
    or (dsa_id is not null and dsa_id = (select public.nw_current_dsa_id()) and client_id is null)
  );

create policy nw_watchlist_delete_own on public.nw_watchlist
  for delete to authenticated
  using (
    (client_id is not null and client_id = (select public.nw_current_client_id()))
    or (dsa_id is not null and dsa_id = (select public.nw_current_dsa_id()))
  );

-- No UPDATE: a watch is added or removed, never edited.
revoke all on public.nw_watchlist from anon, public;
grant select, insert, delete on public.nw_watchlist to authenticated;
grant all on public.nw_watchlist to service_role;
