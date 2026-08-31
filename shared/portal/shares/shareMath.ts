/**
 * What a client pays for an unlisted share order.
 * -----------------------------------------------------------------------------
 * Far simpler than the bond equivalent, and deliberately so: a share has no
 * coupon and no accrued interest, so the amount is quantity × price. The value
 * of having it here rather than inline is the QUANTITY RULE — minimum lot and
 * step — which the detail page's stepper, the order review and the server all
 * have to agree on. The server re-derives it in place-share-order; if these two
 * ever disagree the client sees a quantity accepted by the UI and rejected on
 * submit, which is exactly the bug this file exists to prevent.
 *
 * Money rounds to paise. The price itself is already stored at 2dp (a share
 * price is a rupee amount, not a rate applied to a face value the way a bond's
 * price-per-₹100 is), so there is no 4dp rate to preserve here.
 */

/** The shape both the client and partner projections share for quantity maths. */
export interface QuantityRules {
  min_qty: number | null;
  lot_size: number | null;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Smallest order the desk will accept for this share. */
export function minQty(share: QuantityRules): number {
  return Math.max(1, Math.round(Number(share.min_qty) || 1));
}

/** The increment above the minimum. */
export function stepQty(share: QuantityRules): number {
  return Math.max(1, Math.round(Number(share.lot_size) || 1));
}

/** Is this a quantity the server will accept? Mirrors the edge function exactly. */
export function isValidQty(share: QuantityRules, qty: number): boolean {
  const min = minQty(share);
  const step = stepQty(share);
  return Number.isInteger(qty) && qty >= min && (qty - min) % step === 0;
}

export interface ShareBreakdown {
  qty: number;
  pricePerShare: number;
  /** qty × price, to paise. Stamp duty is settled on the deal confirmation. */
  amount: number;
}

export function shareBreakdown(pricePerShare: number | null, qty: number): ShareBreakdown {
  const price = Number(pricePerShare) || 0;
  return { qty, pricePerShare: price, amount: r2(qty * price) };
}
