/**
 * What a partner's client pays, and what the partner makes on it.
 * -----------------------------------------------------------------------------
 * A partner sells at their COST (`partner_base`, set by their RM) plus a spread
 * they choose per bond, capped at 5%. Three places need that number — the order
 * they raise for a client, the shareable offer link they mint, and now the app —
 * and the server re-derives it a fourth time in `place-bond-order` /
 * `nw_partner_create_bond_share`.
 *
 * It was written out by hand in each web modal, and the two had already drifted:
 * the order modal rounded with an epsilon nudge and the share modal without, so
 * a price sitting exactly on a half-paise boundary could be quoted in a link and
 * then booked one paisa apart. Nobody would have noticed quickly, and it is the
 * partner's income. One copy, here.
 *
 * ## Why the price is rounded to four places and the money to two
 *
 * `price_per_100` is a rate, not an amount — it is multiplied by units × face,
 * so rounding it to paise first would magnify the error by the size of the
 * trade. Four places matches the column the server snapshots it into. The
 * rupee figures derived FROM it are money, and round to paise.
 *
 * ## What is deliberately NOT here
 *
 * The partner's cost never reaches a client-facing surface. These functions take
 * `partner_base` and are only ever called from partner screens; the client sees
 * a price the server computed. See the security invariant on `bm_public_analytics`.
 */
import type { PartnerBond } from '../services/PartnerService';

/** The hard cap on a partner's spread. The server enforces this too. */
export const MAX_PARTNER_MARGIN = 5;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * A typed margin out of whatever the input field holds.
 *
 * Takes a string because that is what a text field gives, on both platforms, and
 * every caller was otherwise repeating the same parse-clamp-default dance. An
 * unparseable value becomes 0 rather than NaN: a margin field the user has
 * emptied should price at cost, not poison every figure on the screen with NaN.
 */
export function clampMargin(input: string | number | null | undefined): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input ?? ''));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_PARTNER_MARGIN, Math.max(0, n));
}

/** Is what the user has typed a usable margin? Empty is not — it is unanswered. */
export function isMarginValid(input: string | number | null | undefined): boolean {
  const n = typeof input === 'number' ? input : parseFloat(String(input ?? ''));
  return Number.isFinite(n) && n >= 0 && n <= MAX_PARTNER_MARGIN;
}

/** The price the partner's client sees, per ₹100 face: cost + the partner's spread. */
export function partnerPricePer100(
  bond: Pick<PartnerBond, 'partner_base'>,
  margin: string | number,
): number {
  const base = Number(bond.partner_base) || 0;
  return r4(base * (1 + clampMargin(margin) / 100));
}

export interface PartnerOrderBreakdown {
  units: number;
  face: number;
  margin: number;
  pricePer100: number;
  investment: number;
  accrued: number;
  amount: number;
  /** What the spread earns on this trade — cost vs. price, over the whole lot. */
  yourMargin: number;
}

/**
 * The indicative figures for an order at the partner's own price.
 *
 * Mirrors `breakdown()` in `shared/portal/bonds/bondMath.ts` — same accrued
 * treatment, same rounding, same "stamp duty is settled on the deal
 * confirmation" omission — but priced off `partner_base` + margin rather than
 * off an admin-approved client price.
 */
export function partnerBreakdown(
  bond: PartnerBond,
  units: number,
  margin: string | number,
): PartnerOrderBreakdown {
  const face = Number(bond.face_value) || 100;
  const m = clampMargin(margin);
  const pricePer100 = partnerPricePer100(bond, m);
  const basePer100 = Number(bond.partner_base) || 0;
  const accruedPer100 = Number(bond.analytics?.accrued_per_100) || 0;

  const investment = r2(units * face * (pricePer100 / 100));
  const accrued = r2(units * face * (accruedPer100 / 100));
  const atCost = r2(units * face * (basePer100 / 100));

  return {
    units,
    face,
    margin: m,
    pricePer100,
    investment,
    accrued,
    amount: r2(investment + accrued),
    yourMargin: r2(investment - atCost),
  };
}
