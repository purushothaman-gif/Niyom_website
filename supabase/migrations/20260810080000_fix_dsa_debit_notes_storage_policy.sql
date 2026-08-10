-- Employees (non-admin) could not GENERATE a DSA debit note: the PDF upload to
-- the dsa-debit-notes storage bucket failed with
--   "new row violates row-level security policy for table objects".
-- Only the super_admin ever succeeded (every dsa_debit_notes row was created_by
-- NIYOM-001). Root cause: the bucket's INSERT/UPDATE storage policies gated on a
-- RAW subquery `EXISTS (SELECT 1 FROM nw_employees WHERE auth_user_id = auth.uid())`,
-- which is itself subject to nw_employees RLS and evaluates empty for a regular
-- employee in the storage execution context. The crm-documents bucket (which
-- employees CAN upload to) instead uses the SECURITY DEFINER helper
-- nw_current_employee_id(), bypassing that nested RLS. Aligned to that pattern.
-- Applied to hosted DB via the migration API on 2026-08-10.

alter policy "Employees can upload dsa debit notes" on storage.objects
  with check (
    (bucket_id = 'dsa-debit-notes'::text)
    and ((select nw_current_employee_id()) is not null)
  );

alter policy "Employees can update dsa debit notes objects" on storage.objects
  using (
    (bucket_id = 'dsa-debit-notes'::text)
    and ((select nw_current_employee_id()) is not null)
  )
  with check (
    (bucket_id = 'dsa-debit-notes'::text)
    and ((select nw_current_employee_id()) is not null)
  );
