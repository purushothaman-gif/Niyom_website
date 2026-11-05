-- =============================================================================
-- Client bank additions: RM approval instead of Cashfree penny-drop
-- (user decision 2026-11-06).
--
-- A bank account a client adds in the portal lands as 'pending'. It is not
-- usable (cannot be primary, does not count toward the one-account minimum)
-- until the client's RM or an admin approves it in the CRM. Approval marks it
-- 'verified' (by the reviewer) and, if the client asked, makes it primary and
-- updates the nw_clients bank mirror. Rejection marks it 'rejected' with a note
-- the client sees. Every review is logged in nw_client_profile_changes.
-- =============================================================================

alter table public.nw_client_bank_accounts
  drop constraint if exists nw_client_bank_accounts_verification_status_check;
alter table public.nw_client_bank_accounts
  add constraint nw_client_bank_accounts_verification_status_check
  check (verification_status in ('unverified', 'pending', 'verified', 'rejected', 'failed'));

alter table public.nw_client_bank_accounts
  add column if not exists requested_primary boolean not null default false,
  add column if not exists reviewed_by uuid references public.nw_employees(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

create or replace function public.nw_review_client_bank(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp   uuid := nw_current_employee_id();
  v_admin boolean := coalesce(nw_current_emp_is_admin(), false);
  v_acc   nw_client_bank_accounts%rowtype;
  v_owner uuid;
  v_label text;
begin
  if v_emp is null then
    raise exception 'Only staff can review bank accounts';
  end if;

  select * into v_acc from nw_client_bank_accounts where id = p_id for update;
  if not found then
    raise exception 'Bank account not found';
  end if;
  select employee_id into v_owner from nw_clients where id = v_acc.client_id;
  if not v_admin and v_owner is distinct from v_emp then
    raise exception 'Only the client''s relationship manager or an admin can review this account';
  end if;
  if v_acc.verification_status <> 'pending' then
    raise exception 'This account is not awaiting approval';
  end if;

  v_label := coalesce(nullif(v_acc.bank_name, ''), 'Bank') || ' XXXX' || right(v_acc.account_number, 4) || ' ' || v_acc.ifsc;

  if p_approve then
    if v_acc.requested_primary then
      update nw_client_bank_accounts set is_primary = false where client_id = v_acc.client_id;
    end if;
    update nw_client_bank_accounts
       set verification_status = 'verified',
           verified_at = now(),
           reviewed_by = v_emp,
           reviewed_at = now(),
           review_note = nullif(trim(p_note), ''),
           is_primary = case when v_acc.requested_primary then true else is_primary end,
           updated_at = now()
     where id = p_id;
    if v_acc.requested_primary then
      update nw_clients
         set bank_account = v_acc.account_number, bank_ifsc = v_acc.ifsc,
             bank_name = v_acc.bank_name, bank_verified = true, updated_at = now()
       where id = v_acc.client_id;
    end if;
    insert into nw_client_profile_changes (client_id, field, old_value, new_value, source)
    values (v_acc.client_id, 'bank_account_approved', null,
            v_label || case when v_acc.requested_primary then ' (primary)' else '' end, 'crm');
  else
    update nw_client_bank_accounts
       set verification_status = 'rejected',
           reviewed_by = v_emp,
           reviewed_at = now(),
           review_note = coalesce(nullif(trim(p_note), ''), 'Not approved'),
           is_primary = false,
           updated_at = now()
     where id = p_id;
    insert into nw_client_profile_changes (client_id, field, old_value, new_value, source)
    values (v_acc.client_id, 'bank_account_rejected', v_label, coalesce(nullif(trim(p_note), ''), 'Not approved'), 'crm');
  end if;

  return jsonb_build_object('ok', true, 'status', case when p_approve then 'verified' else 'rejected' end);
end;
$$;

revoke all on function public.nw_review_client_bank(uuid, boolean, text) from public, anon;
grant execute on function public.nw_review_client_bank(uuid, boolean, text) to authenticated;
