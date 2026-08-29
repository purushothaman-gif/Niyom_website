// Pure helpers for the client bond module: the lot rule (min units / step) the
// server also enforces, tenure labelling, and the indicative order breakdown the
// review screen shows. Everything is per ₹100 face until multiplied out here.

import type { ClientBond } from '../services/BondOrderService';

/**
 * The minimal shape the filter + display helpers need, shared by the client
 * (ClientBond) and partner (PartnerBond) bond projections so one filter/detail
 * implementation serves both. `analytics` is permissive (index signature) so
 * either projection's analytics blob is assignable.
 */
export interface FilterableBond {
  coupon_rate: number | null;
  coupon_frequency: string | null;
  maturity_date: string | null;
  rating: string | null;
  security_type: string | null;
  tax_status: string | null;
  min_investment: number | null;
  face_value: number | null;
  analytics: { ytm?: number | null; years_to_maturity?: number | null; [k: string]: unknown } | null;
}

/** Smallest orderable quantity = the min-investment lot, in units of face value. */
export function minUnits(b: Pick<ClientBond, 'min_investment' | 'face_value'>): number {
  const face = Number(b.face_value) || 100;
  return Math.max(1, Math.ceil((Number(b.min_investment) || face) / face));
}

/** Quantity step. Bonds trade in whole units; the admin lot override (lot_size)
 *  isn't exposed to the client RPC, so the client steps one min-lot at a time. */
export function stepUnits(b: Pick<ClientBond, 'min_investment' | 'face_value'>): number {
  return minUnits(b);
}

/** Human tenure from years-to-maturity (preferred) or the maturity date. */
export function tenureLabel(b: FilterableBond): string {
  const y = b.analytics?.years_to_maturity;
  if (y != null && Number.isFinite(y)) {
    if (y < 1) {
      const months = Math.max(1, Math.round(y * 12));
      return `${months} mo`;
    }
    return `${(Math.round(y * 10) / 10).toFixed(1)} yr`;
  }
  if (b.maturity_date) {
    const d = new Date(b.maturity_date);
    if (!Number.isNaN(d.getTime())) {
      const yrs = (d.getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000);
      if (yrs > 0) return yrs < 1 ? `${Math.max(1, Math.round(yrs * 12))} mo` : `${yrs.toFixed(1)} yr`;
    }
  }
  return '—';
}

export interface OrderBreakdown {
  units: number;
  face: number;
  faceValueTotal: number;   // units × face (redemption principal)
  pricePer100: number;
  pricePerUnit: number;     // price for one bond = face × price/100
  premium: number;          // (price − 100)/100 × face × units; negative = discount
  investment: number;       // units × face × price/100  (principal ± premium)
  accruedPer100: number;
  accrued: number;          // units × face × accrued_per_100/100
  stampDuty: number;        // 0 here — finalised on the Deal Confirmation
  amountPayable: number;    // investment + accrued + stamp
  estMaturityValue: number | null;  // indicative total inflows if held to maturity
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The indicative order breakdown, mirroring the server's amount computation. */
export function breakdown(b: ClientBond, units: number): OrderBreakdown {
  const face = Number(b.face_value) || 100;
  const pricePer100 = Number(b.client_price) || 0;
  const accruedPer100 = Number(b.analytics?.accrued_per_100) || 0;

  const faceValueTotal = r2(units * face);
  const investment = r2(units * face * (pricePer100 / 100));
  const premium = r2(investment - faceValueTotal);
  const accrued = r2(units * face * (accruedPer100 / 100));
  const stampDuty = 0;
  const amountPayable = r2(investment + accrued + stampDuty);

  const futInt = b.analytics?.total_future_interest_per_100;
  const futPrin = b.analytics?.total_future_principal_per_100;
  let estMaturityValue: number | null = null;
  if (futInt != null || futPrin != null) {
    const prin = futPrin != null ? Number(futPrin) : 100;   // bullet redemption if unknown
    estMaturityValue = r2(units * face * ((prin + (Number(futInt) || 0)) / 100));
  }

  const pricePerUnit = r2(face * (pricePer100 / 100));

  return {
    units, face, faceValueTotal, pricePer100, pricePerUnit, premium, investment,
    accruedPer100, accrued, stampDuty, amountPayable, estMaturityValue,
  };
}
