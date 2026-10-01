-- 2026-10-01: two Hinduja Leyland Finance unlisted-share deals for Prabhu S
-- (NIYOM-007) — Uma Shankar (DC-1790602876813, deal 28 Sep) and Ponnappan
-- Vinoth Kumar (DC-1790765482478, deal 30 Sep). Deal notes went out in
-- September but payment landed 1 Oct 2026, so MIS dated them October. Moved to
-- September 2026 on management instruction (₹7,000 each, ₹14,000 total).
--
-- One-off for these two deals ONLY. The rule is unchanged: every other deal
-- keeps earning in the month it is paid in full.
INSERT INTO nw_mis_revenue_shifts (deal_confirmation_id, recognise_on, reason, created_by)
SELECT d.id, d.deal_date,
       'Deal note sent in Sep 2026, payment received 1 Oct 2026 — revenue recognised in Sep 2026 on management instruction (1 Oct 2026). One-off for this deal only.',
       (SELECT id FROM nw_employees WHERE employee_code = 'NIYOM-001')
FROM nw_deal_confirmations d
WHERE d.confirmation_number IN ('DC-1790765482478', 'DC-1790602876813')
ON CONFLICT (deal_confirmation_id) DO NOTHING;
