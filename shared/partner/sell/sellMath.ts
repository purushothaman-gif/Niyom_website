/**
 * "Sell today" figures for a partner — what their own spread adds on a ₹1 lakh
 * client deal.
 *
 * Nothing is computed here beyond choosing the quantity: the rupee figure comes
 * ONLY from partnerBondMath / partnerShareMath, which are the single copies of
 * the spread maths. This is the spread, NOT the partner's whole income — debit
 * note payouts are computed in the CRM's DSAPayout and never here.
 *
 * Mirrors the helpers inside the website's src/partner/features/sell/SellCards.tsx
 * so the app can use them without importing a React component file.
 */
import type { PartnerBond, PartnerShare } from '../services/PartnerService';
import { partnerBreakdown } from '../bonds/partnerBondMath';
import { partnerShareBreakdown } from '../shares/partnerShareMath';

const LAKH = 100_000;

/** Spread earned on a ₹1 lakh client investment at the partner's current markup. */
export function bondEarnPerLakh(b: PartnerBond): number | null {
  const margin = b.self_markup_percent ?? 0;
  const face = Number(b.face_value) || 100;
  const price = Number(b.partner_price) || 0;
  if (!(price > 0) || !(Number(b.partner_base) > 0)) return null;
  const units = LAKH / (face * (price / 100));
  return partnerBreakdown(b, units, margin).yourMargin;
}

export function shareEarnPerLakh(s: PartnerShare): number | null {
  const margin = s.self_markup_percent ?? 0;
  const price = Number(s.partner_price) || 0;
  if (!(price > 0) || !(Number(s.partner_base) > 0)) return null;
  return partnerShareBreakdown(s, LAKH / price, margin).yourMargin;
}

/** Bonds still open (not matured), highest yield first. */
export function sellTodayBonds(bonds: PartnerBond[], n = 6, now: Date = new Date()): PartnerBond[] {
  const y = (b: PartnerBond) => Number(b.analytics?.ytm ?? b.coupon_rate) || 0;
  return bonds
    .filter((b) => !b.maturity_date || new Date(b.maturity_date) > now)
    .sort((a, b) => y(b) - y(a))
    .slice(0, n);
}
