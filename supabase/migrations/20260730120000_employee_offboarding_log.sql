-- ===========================================================================
-- Employee offboarding (resignation) — audit log
-- ---------------------------------------------------------------------------
-- Deleting an employee row is now possible from the CRM (Employees → Delete),
-- for resignations. Almost every FK into nw_employees is ON DELETE SET NULL,
-- so business history (transactions, deals, debit notes, activity logs)
-- survives the delete — but the *identity* of who did that work would be lost
-- forever. This table keeps a permanent snapshot of every deleted employee:
-- who they were, who deleted them, who inherited their book, and the workload
-- counts at the moment of deletion.
--
-- Writes happen only from the `delete-crm-user` edge function (service role),
-- so no INSERT/UPDATE/DELETE policy is granted to authenticated users.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS nw_employee_offboarding_log (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code             text NOT NULL,
  full_name                 text NOT NULL,
  email                     text,
  role                      text,
  designation               text,
  joining_date              date,
  deleted_by_employee_id    uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  deleted_by_name           text,
  reassigned_to_employee_id uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  reassigned_to_name        text,
  reason                    text,
  impact                    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- workload counts at delete time
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- FK indexes (see 20260727125000_fk_indexes_perf.sql — unindexed FKs were a
-- measured source of slowdown on this database).
CREATE INDEX IF NOT EXISTS idx_emp_offboarding_deleted_by
  ON nw_employee_offboarding_log(deleted_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_offboarding_reassigned_to
  ON nw_employee_offboarding_log(reassigned_to_employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_offboarding_created_at
  ON nw_employee_offboarding_log(created_at DESC);

ALTER TABLE nw_employee_offboarding_log ENABLE ROW LEVEL SECURITY;

-- Read-only for admins. Initplan-safe: helper wrapped in a scalar subquery so
-- it is evaluated once per query, not once per row (see 20260727130000).
DROP POLICY IF EXISTS nw_employee_offboarding_log_select ON nw_employee_offboarding_log;
CREATE POLICY nw_employee_offboarding_log_select ON nw_employee_offboarding_log
  FOR SELECT TO authenticated
  USING ((SELECT nw_current_emp_is_admin()));
