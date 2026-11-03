-- MF registrar transaction feed → per-purchase trade dates + true cost basis.
--
-- The holdings/AUM snapshots we already ingest (CAMS WBR9, KFintech WBCUM) carry
-- only a balance as-on-date — no purchase date, no cost. The TRANSACTION feeds do:
-- CAMS WBR2 "Investor Transactions for a Period" / WBR2A (historical) and
-- KFintech WBTRN "Transaction Feeds". This table stages one row per registrar
-- transaction, keyed by (registrar, txn_ref), PAN-matched to a client exactly
-- like folios/sips. The read model derives each holding's first investment date
-- and net invested cost from these rows.
create table if not exists mf_rta_transactions (
  id uuid primary key default gen_random_uuid(),
  registrar text not null,
  txn_ref text not null,
  folio text not null,
  scheme_code text not null,
  folio_id uuid references mf_rta_folios (id) on delete set null,
  scheme_name text,
  amc_code text,
  holder_name text,
  pan text,
  -- normalised direction: purchase | redemption | switch_in | switch_out | dividend | sip | other
  txn_kind text not null default 'other',
  txn_type_raw text,
  trade_date date,
  post_date date,
  amount numeric,
  units numeric,
  nav numeric,
  euin text,
  sub_broker text,
  arn text,
  client_id uuid references nw_clients (id) on delete set null,
  matched_at timestamptz,
  snapshot_date date,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registrar, txn_ref)
);

create index if not exists mf_rta_txn_folio_scheme on mf_rta_transactions (folio, scheme_code);
create index if not exists mf_rta_txn_client on mf_rta_transactions (client_id);
create index if not exists mf_rta_txn_folio_id on mf_rta_transactions (folio_id);

alter table mf_rta_transactions enable row level security;

-- Read: admins see all; a client sees their own; an RM sees their clients'.
-- Mirrors mf_rta_sips_read. No write policy → only the service-role import path
-- (RLS-bypassing) writes, same as the other feed tables.
drop policy if exists mf_rta_transactions_read on mf_rta_transactions;
create policy mf_rta_transactions_read on mf_rta_transactions for select
  using (
    (select nw_current_emp_is_admin())
    or client_id = (select nw_current_client_id())
    or client_id in (
      select nw_clients.id from nw_clients
      where nw_clients.employee_id = (select nw_current_employee_id())
    )
  );
