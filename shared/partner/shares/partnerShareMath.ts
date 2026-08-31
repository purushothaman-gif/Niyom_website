/**
 * What a partner's client pays for an unlisted share, and what the partner makes.
 * -----------------------------------------------------------------------------
 * A partner sells at their COST (`partner_base`, which is the base price plus the
 * markup their RM had approved for them) plus a spread they choose per share,
 * capped at 5%. Four places need that number — the order they raise for a client,
 * the shareable offer link they mint, this app's screens, and the server, which
 * re-derives it independently in place-partner-share-order / submit-share-offer.
 *
 * It lives in exactly one file for the reason the bond version documents at
 * length: the bond spread was written out by hand in each modal, the copies
 * drifted on rounding, and a price could be quoted in a link and then booked a
 * paisa apart. Nobody would have noticed quickly, and it is the partner's income.
 *
 * Unlike bonds, a share price is a rupee amount rather than a rate applied to a
 * face value, so everything here rounds to paise — there is no 4dp rate to keep.
 *
 * ## What is deliberately NOT here
 *
 * The partner's cost never reaches a client-facing surface. These functions take
 * `partner_base` and are only ever called from partner screens; the client and
 * the public offer page see a price the server computed. See the security
 * invariant on resolve-share-offer.
 */

/** The hard cap on a partner's spread. The server enforces this too. */
export const MAX_PARTNER_SHARE_MARGIN = 5;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The subset of a partner share row the maths needs. */
export interface PartnerPricedShare {
  partner_base: number | null;
  min_qty?: number | null;
  lot_size?: number | null;
}

/**
 * A typed margin out of whatever the input field holds.
 *
 * Takes a string because that is what a text field gives, on both platforms. An
 * unparseable value becomes 0 rather than NaN: a margin field the user has
 * emptied should price at cost, not poison every figure on the screen with NaN.
 */
export function clampShareMargin(input: string | number | null | undefined): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input ?? ''));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_PARTNER_SHARE_MARGIN, Math.max(0, n));
}

/** Is what the user has typed a usable margin? Empty is not — it is unanswered. */
export function isShareMarginValid(input: string | number | null | undefined): boolean {
  const n = typeof input === 'number' ? input : parseFloat(String(input ?? ''));
  return Number.isFinite(n) && n >= 0 && n <= MAX_PARTNER_SHARE_MARGIN;
}

/** The price the partner's client sees, per share: cost + the partner's spread. */
export function partnerSharePrice(
  share: PartnerPricedShare,
  margin: string | number,
): number {
  const base = Number(share.partner_base) || 0;
  return r2(base * (1 + clampShareMargin(margin) / 100));
}

export interface PartnerShareBreakdown {
  qty: number;
  margin: number;
  pricePerShare: number;
  /** qty × price. Stamp duty is settled on the deal confirmation. */
  amount: number;
  /** What the spread earns on this trade — cost vs. price, over the whole lot. */
  yourMargin: number;
}

export function partnerShareBreakdown(
  share: PartnerPricedShare,
  qty: number,
  margin: string | number,
): PartnerShareBreakdown {
  const m = clampShareMargin(margin);
  const pricePerShare = partnerSharePrice(share, m);
  const base = Number(share.partner_base) || 0;
  const amount = r2(qty * pricePerShare);
  const atCost = r2(qty * base);
  return { qty, margin: m, pricePerShare, amount, yourMargin: r2(amount - atCost) };
}
