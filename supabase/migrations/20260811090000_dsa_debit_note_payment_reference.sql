-- Payment/transfer reference captured when a DSA debit note is marked paid.
-- Applied to the hosted DB via the CLI on 2026-08-11.
alter table dsa_debit_notes add column if not exists payment_reference text;
