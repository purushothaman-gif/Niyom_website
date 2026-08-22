-- =============================================================================
-- NIYOM HR & PAYROLL -- 14: private storage for payslips and bank files
--
-- Payslip path is  payslips/{employee_id}/{run_id}.pdf  so an employee's own
-- prefix is checkable from the object name alone.
--
-- Both policies call SECURITY DEFINER helpers rather than sub-selecting
-- nw_employees directly. That distinction has already cost this project once:
-- the dsa-debit-notes bucket used a raw EXISTS(...) subquery, which is itself
-- subject to nw_employees RLS inside the storage execution context, so every
-- non-admin upload failed. See 20260810080000.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('hr-payslips', 'hr-payslips', false, 5242880)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('hr-payment-files', 'hr-payment-files', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- --- Payslips ---------------------------------------------------------------

DROP POLICY IF EXISTS "hr payslips read own or hr" ON storage.objects;
CREATE POLICY "hr payslips read own or hr" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'hr-payslips'
    AND (
      (SELECT hr_can_view('payslips'))
      OR (storage.foldername(name))[2] = (SELECT nw_current_employee_id())::text
    )
  );

DROP POLICY IF EXISTS "hr payslips write hr only" ON storage.objects;
CREATE POLICY "hr payslips write hr only" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hr-payslips' AND (SELECT hr_can_edit('payslips')));

DROP POLICY IF EXISTS "hr payslips update hr only" ON storage.objects;
CREATE POLICY "hr payslips update hr only" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'hr-payslips' AND (SELECT hr_can_edit('payslips')))
  WITH CHECK (bucket_id = 'hr-payslips' AND (SELECT hr_can_edit('payslips')));

DROP POLICY IF EXISTS "hr payslips delete admin only" ON storage.objects;
CREATE POLICY "hr payslips delete admin only" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'hr-payslips' AND (SELECT nw_current_emp_is_admin()));

-- --- Bank transfer files -----------------------------------------------------
-- No employee-facing policy of any kind: a salary transfer file lists what
-- everyone in the company is paid.

DROP POLICY IF EXISTS "hr payment files hr only" ON storage.objects;
CREATE POLICY "hr payment files hr only" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'hr-payment-files' AND (SELECT hr_can_view('payroll')));

DROP POLICY IF EXISTS "hr payment files write hr only" ON storage.objects;
CREATE POLICY "hr payment files write hr only" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hr-payment-files' AND (SELECT hr_can_edit('payroll')));

DROP POLICY IF EXISTS "hr payment files update hr only" ON storage.objects;
CREATE POLICY "hr payment files update hr only" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'hr-payment-files' AND (SELECT hr_can_edit('payroll')))
  WITH CHECK (bucket_id = 'hr-payment-files' AND (SELECT hr_can_edit('payroll')));

DROP POLICY IF EXISTS "hr payment files delete admin only" ON storage.objects;
CREATE POLICY "hr payment files delete admin only" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'hr-payment-files' AND (SELECT nw_current_emp_is_admin()));