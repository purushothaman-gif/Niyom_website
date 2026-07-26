-- Performance: index the 43 foreign-key columns flagged by advisor
-- `unindexed_foreign_keys`. Unindexed FKs force sequential scans on joins and
-- on cascade checks, which degrade as these tables grow.
--
-- NOTE: In production these were created with CREATE INDEX CONCURRENTLY (zero
-- table lock). This migration uses plain CREATE INDEX IF NOT EXISTS so it is a
-- safe no-op against the live DB (indexes already present) and can be replayed
-- on a fresh environment. CONCURRENTLY cannot run inside a migration transaction,
-- so it is intentionally not used here.

CREATE INDEX IF NOT EXISTS idx_bm_bonds_created_by ON public.bm_bonds (created_by);
CREATE INDEX IF NOT EXISTS idx_bm_bonds_modified_by ON public.bm_bonds (modified_by);
CREATE INDEX IF NOT EXISTS idx_bm_field_provenance_verified_by ON public.bm_field_provenance (verified_by);
CREATE INDEX IF NOT EXISTS idx_bm_provider_log_bond_id ON public.bm_provider_log (bond_id);
CREATE INDEX IF NOT EXISTS idx_bm_verification_queue_resolved_by ON public.bm_verification_queue (resolved_by);
CREATE INDEX IF NOT EXISTS idx_dsa_debit_notes_sent_by ON public.dsa_debit_notes (sent_by);
CREATE INDEX IF NOT EXISTS idx_dsa_debit_notes_paid_by ON public.dsa_debit_notes (paid_by);
CREATE INDEX IF NOT EXISTS idx_dsa_debit_notes_cancelled_by ON public.dsa_debit_notes (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_nw_activity_logs_client_id ON public.nw_activity_logs (client_id);
CREATE INDEX IF NOT EXISTS idx_nw_alerts_lead_id ON public.nw_alerts (lead_id);
CREATE INDEX IF NOT EXISTS idx_nw_client_documents_uploaded_by ON public.nw_client_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_nw_client_documents_client_id ON public.nw_client_documents (client_id);
CREATE INDEX IF NOT EXISTS idx_nw_deal_confirmations_revenue_basis_entered_by ON public.nw_deal_confirmations (revenue_basis_entered_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_confirmations_revenue_basis_last_modified_by ON public.nw_deal_confirmations (revenue_basis_last_modified_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_email_log_sent_by ON public.nw_deal_email_log (sent_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_payments_created_by ON public.nw_deal_payments (created_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_payments_posted_by ON public.nw_deal_payments (posted_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_payments_reverses_payment_id ON public.nw_deal_payments (reverses_payment_id);
CREATE INDEX IF NOT EXISTS idx_nw_deal_payments_receipt_generated_by ON public.nw_deal_payments (receipt_generated_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_payments_cancelled_by ON public.nw_deal_payments (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_payments_updated_by ON public.nw_deal_payments (updated_by);
CREATE INDEX IF NOT EXISTS idx_nw_deal_payments_reconciled_by ON public.nw_deal_payments (reconciled_by);
CREATE INDEX IF NOT EXISTS idx_nw_document_logs_employee_id ON public.nw_document_logs (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_activities_employee_id ON public.nw_lead_activities (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_assignments_from_employee_id ON public.nw_lead_assignments (from_employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_assignments_to_employee_id ON public.nw_lead_assignments (to_employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_assignments_assigned_by_employee_id ON public.nw_lead_assignments (assigned_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_audit_employee_id ON public.nw_lead_audit (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_communications_employee_id ON public.nw_lead_communications (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_documents_employee_id ON public.nw_lead_documents (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_duplicate_requests_existing_lead_id ON public.nw_lead_duplicate_requests (existing_lead_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_duplicate_requests_reviewed_by ON public.nw_lead_duplicate_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_nw_lead_duplicate_requests_requested_by_employee_id ON public.nw_lead_duplicate_requests (requested_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_notes_employee_id ON public.nw_lead_notes (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_lead_status_history_employee_id ON public.nw_lead_status_history (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_login_audit_employee_id ON public.nw_login_audit (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_password_reset_otps_employee_id ON public.nw_password_reset_otps (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_support_tickets_assigned_employee_id ON public.nw_support_tickets (assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_transactions_employee_id ON public.nw_transactions (employee_id);
CREATE INDEX IF NOT EXISTS idx_nw_transactions_transferred_by ON public.nw_transactions (transferred_by);
CREATE INDEX IF NOT EXISTS idx_nw_transactions_dsa_id ON public.nw_transactions (dsa_id);
CREATE INDEX IF NOT EXISTS idx_nw_txn_documents_uploaded_by ON public.nw_txn_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_nw_txn_documents_txn_id ON public.nw_txn_documents (txn_id);

-- Refresh planner statistics on the large lead tables (was never analyzed).
ANALYZE public.nw_leads;
ANALYZE public.nw_lead_audit;
ANALYZE public.nw_lead_activities;
ANALYZE public.nw_lead_status_history;
ANALYZE public.nw_lead_assignments;
ANALYZE public.nw_alerts;
