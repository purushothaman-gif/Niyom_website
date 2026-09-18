-- MIS revenue shifts: recognise a deal's landing-cost revenue in a different
-- month than the one it was paid in, WITHOUT touching the payment ledger.
--
-- The MIS engine (src/crm/misRevenue.ts) dates landing-cost revenue by the
-- deal's final payment. A row here overrides that date for MIS only; payment
-- records, transfer dates and the closure email are unaffected. One row per
-- deal, so a deal's revenue is always counted in exactly one month.

CREATE TABLE IF NOT EXISTS nw_mis_revenue_shifts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_confirmation_id uuid NOT NULL UNIQUE REFERENCES nw_deal_confirmations(id) ON DELETE CASCADE,
  recognise_on         date NOT NULL,
  reason               text NOT NULL CHECK (length(trim(reason)) > 0),
  created_by           uuid REFERENCES nw_employees(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE nw_mis_revenue_shifts ENABLE ROW LEVEL SECURITY;

-- Readable by any active employee (MIS already scopes which deals each role
-- sees; this table only carries a date per deal). No write policies: shifts
-- are recorded by migration / service role only.
DROP POLICY IF EXISTS "Active employees read MIS revenue shifts" ON nw_mis_revenue_shifts;
CREATE POLICY "Active employees read MIS revenue shifts"
  ON nw_mis_revenue_shifts FOR SELECT TO authenticated
  USING ((SELECT nw_is_active_employee((SELECT auth.uid()))));

REVOKE ALL ON nw_mis_revenue_shifts FROM anon;
GRANT SELECT ON nw_mis_revenue_shifts TO authenticated;

-- 2026-09-18: Suriya M (NIYOM-009) — August 2026 revenue (two secondary-bond
-- deals for Yuthika Karthikeyan, paid 27 Aug 2026, ₹6,278.08 total) moved to
-- September 2026 on management instruction.
INSERT INTO nw_mis_revenue_shifts (deal_confirmation_id, recognise_on, reason, created_by)
SELECT d.id, DATE '2026-09-01',
       'Aug 2026 revenue of Suriya M moved to Sep 2026 on management instruction (18 Sep 2026)',
       (SELECT id FROM nw_employees WHERE employee_code = 'NIYOM-001')
FROM nw_deal_confirmations d
WHERE d.confirmation_number IN ('DC-1787816640924', 'DC-1787809403498')
ON CONFLICT (deal_confirmation_id) DO NOTHING;
