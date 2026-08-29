/**
 * The bond marketplace filter, as pure functions.
 * -----------------------------------------------------------------------------
 * Yield / Tenure / Min-Investment are fixed ranges; Rating / Payout / Tax /
 * Collateral are derived from the bonds actually on offer, so a bucket nobody
 * can select is never shown. Multi-select within a category is OR; across
 * categories it is AND.
 *
 * This lives in `shared/` rather than beside the web modal because the phone
 * needs the same buckets. A filter that lets a bond through on one surface and
 * not the other is a support call, not a cosmetic difference — and the ranges
 * here ("8 – 10%", "₹1 – 3 L") are the product's own vocabulary, quoted back to
 * the client on chips. The web modal and the RN sheet are two presentations of
 * this one set of rules; neither owns them.
 */
import type { FilterableBond } from './bondMath';

export interface BondFilters {
  yield: string[];
  tenure: string[];
  minInv: string[];
  rating: string[];
  payout: string[];
  tax: string[];
  collateral: string[];
}

export type BondFilterCategory = keyof BondFilters;

export const EMPTY_FILTERS: BondFilters = {
  yield: [], tenure: [], minInv: [], rating: [], payout: [], tax: [], collateral: [],
};

export function countFilters(f: BondFilters): number {
  return Object.values(f).reduce((n, arr) => n + arr.length, 0);
}

/* -------------------------------------------------------------------------- */
/*  Derivations — one bond's value in each filterable dimension               */
/* -------------------------------------------------------------------------- */

export function yieldOf(b: FilterableBond): number | null {
  const v = b.analytics?.ytm ?? b.coupon_rate;
  return v == null ? null : Number(v);
}

export function tenureYearsOf(b: FilterableBond): number | null {
  const y = b.analytics?.years_to_maturity;
  if (y != null && Number.isFinite(y)) return Number(y);
  if (b.maturity_date) {
    const d = new Date(b.maturity_date);
    if (!Number.isNaN(d.getTime())) return (d.getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000);
  }
  return null;
}

export function minInvOf(b: FilterableBond): number | null {
  const v = b.min_investment ?? b.face_value;
  return v == null ? null : Number(v);
}

/** The grades a bond can be filed under, best first. */
const GRADE_ORDER = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D'];
const GRADES = new Set(GRADE_ORDER);

/**
 * The credit grade (AAA/AA/A/BBB/…) out of a full rating like "CARE BBB-".
 *
 * ## Why the word boundaries, and why the result is checked against GRADES
 *
 * Ratings arrive as free text — "AAA STABLE BY IND", "AA BY CRISIL",
 * "IND AA, ACUITE AA+" — and A–D are ordinary letters. Scanning for a bare run
 * of them finds the "AB" inside "ST-AB-LE", the "D" ending "IN-D" and the "C"
 * starting "C-RISIL", so the LAST run in the string is very often part of an
 * agency name or an outlook word rather than the grade. That is not a cosmetic
 * problem: it filed "AAA STABLE BY IND" under D and "AA BY CRISIL" under C,
 * which is the difference between the safest grade there is and a default.
 *
 * A grade always stands as its own word (optionally with a +/- notch), so
 * requiring boundaries drops agency names and outlooks on its own — "CRISIL",
 * "ACUITE", "STABLE", "(CE)" all stop matching. The GRADES check is the belt to
 * that pair of braces: anything that still gets through and is not a real grade
 * is discarded rather than shown as a filter bucket nobody can mean.
 *
 * When a bond carries two agencies' grades the LAST is taken, which is the
 * behaviour this has always had.
 */
export function ratingGrade(r: string | null): string | null {
  if (!r) return null;
  const found = r.toUpperCase().match(/\b[A-D]{1,3}\b/g);
  if (!found) return null;
  const valid = found.filter((g) => GRADES.has(g));
  return valid.length ? valid[valid.length - 1] : null;
}

const FREQ_LABEL: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', 'semi-annual': 'Semi-annual',
  'semi_annual': 'Semi-annual', 'half-yearly': 'Semi-annual', annual: 'Annual',
  annually: 'Annual', yearly: 'Annual', cumulative: 'Cumulative',
  'at-maturity': 'At maturity', 'at_maturity': 'At maturity', maturity: 'At maturity',
};

export function payoutOf(b: FilterableBond): string {
  const v = (b.coupon_frequency || '').toLowerCase().replace(/\s+/g, '_');
  if (!v) return '';
  return FREQ_LABEL[v] ?? FREQ_LABEL[v.replace(/_/g, '-')] ?? (v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' '));
}

export const titleCase = (s: string) =>
  s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function taxOf(b: FilterableBond): string { return (b.tax_status || '').trim(); }
export function collateralOf(b: FilterableBond): string { return (b.security_type || '').trim(); }

/* -------------------------------------------------------------------------- */
/*  The fixed range buckets                                                   */
/* -------------------------------------------------------------------------- */

export interface FilterOption { k: string; label: string }

export const YIELD_OPTS: FilterOption[] = [
  { k: 'lt8', label: 'Up to 8%' },
  { k: '8_10', label: '8 – 10%' },
  { k: '10_12', label: '10 – 12%' },
  { k: 'gt12', label: 'More than 12%' },
];
export const TENURE_OPTS: FilterOption[] = [
  { k: 'lt1', label: 'Up to 1 year' },
  { k: '1_3', label: '1 – 3 years' },
  { k: '3_5', label: '3 – 5 years' },
  { k: 'gt5', label: 'More than 5 years' },
];
export const MININV_OPTS: FilterOption[] = [
  { k: 'lt1l', label: 'Up to ₹1 L' },
  { k: '1_3l', label: '₹1 – 3 L' },
  { k: '3_5l', label: '₹3 – 5 L' },
  { k: 'gt5l', label: 'More than ₹5 L' },
];

const STATIC_LABELS: Record<string, Record<string, string>> = {
  yield: Object.fromEntries(YIELD_OPTS.map((o) => [o.k, o.label])),
  tenure: Object.fromEntries(TENURE_OPTS.map((o) => [o.k, o.label])),
  minInv: Object.fromEntries(MININV_OPTS.map((o) => [o.k, o.label])),
};

/** Selected options flattened to removable chips, with display labels. */
export function filterChips(f: BondFilters): Array<{ cat: BondFilterCategory; k: string; label: string }> {
  const chips: Array<{ cat: BondFilterCategory; k: string; label: string }> = [];
  (Object.keys(f) as BondFilterCategory[]).forEach((cat) => {
    f[cat].forEach((k) => {
      const label = STATIC_LABELS[cat] ? (STATIC_LABELS[cat][k] ?? k)
        : (cat === 'tax' || cat === 'collateral') ? titleCase(k) : k;
      chips.push({ cat, k, label });
    });
  });
  return chips;
}

export function removeFilter(f: BondFilters, cat: BondFilterCategory, k: string): BondFilters {
  return { ...f, [cat]: f[cat].filter((x) => x !== k) };
}

/** Toggle one option within a category. */
export function toggleFilter(f: BondFilters, cat: BondFilterCategory, k: string): BondFilters {
  return { ...f, [cat]: f[cat].includes(k) ? f[cat].filter((x) => x !== k) : [...f[cat], k] };
}

/* -------------------------------------------------------------------------- */
/*  Membership tests                                                          */
/* -------------------------------------------------------------------------- */

export function passYield(v: number | null, keys: string[]): boolean {
  if (!keys.length) return true;
  if (v == null) return false;
  return keys.some((k) =>
    k === 'lt8' ? v < 8 : k === '8_10' ? v >= 8 && v < 10 : k === '10_12' ? v >= 10 && v < 12 : v >= 12);
}
export function passTenure(y: number | null, keys: string[]): boolean {
  if (!keys.length) return true;
  if (y == null) return false;
  return keys.some((k) =>
    k === 'lt1' ? y < 1 : k === '1_3' ? y >= 1 && y < 3 : k === '3_5' ? y >= 3 && y < 5 : y >= 5);
}
export function passMinInv(m: number | null, keys: string[]): boolean {
  if (!keys.length) return true;
  if (m == null) return false;
  return keys.some((k) =>
    k === 'lt1l' ? m <= 100000 : k === '1_3l' ? m > 100000 && m <= 300000 : k === '3_5l' ? m > 300000 && m <= 500000 : m > 500000);
}


/** Does a bond pass the whole filter set? */
export function matchesFilters(b: FilterableBond, f: BondFilters): boolean {
  if (!passYield(yieldOf(b), f.yield)) return false;
  if (!passTenure(tenureYearsOf(b), f.tenure)) return false;
  if (!passMinInv(minInvOf(b), f.minInv)) return false;
  if (f.rating.length) { const g = ratingGrade(b.rating); if (!g || !f.rating.includes(g)) return false; }
  if (f.payout.length && !f.payout.includes(payoutOf(b))) return false;
  if (f.tax.length && !f.tax.includes(taxOf(b))) return false;
  if (f.collateral.length && !f.collateral.includes(collateralOf(b))) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/*  The category rail                                                         */
/* -------------------------------------------------------------------------- */

export interface FilterCategory {
  key: BondFilterCategory;
  label: string;
  opts: FilterOption[];
}

/**
 * The seven categories with their selectable options, the last four narrowed to
 * what the offered bonds actually contain. Ratings come back in credit order
 * (AAA first) rather than alphabetically, which would put AA above AAA.
 */
export function filterCategories(bonds: FilterableBond[]): FilterCategory[] {
  const ratings = new Set<string>(), payouts = new Set<string>(), taxes = new Set<string>(), colls = new Set<string>();
  bonds.forEach((b) => {
    const g = ratingGrade(b.rating); if (g) ratings.add(g);
    const p = payoutOf(b); if (p) payouts.add(p);
    const t = taxOf(b); if (t) taxes.add(t);
    const c = collateralOf(b); if (c) colls.add(c);
  });

  return [
    { key: 'yield', label: 'Yield', opts: YIELD_OPTS },
    { key: 'tenure', label: 'Tenure', opts: TENURE_OPTS },
    { key: 'minInv', label: 'Min Investment', opts: MININV_OPTS },
    { key: 'rating', label: 'Rating', opts: GRADE_ORDER.filter((g) => ratings.has(g)).map((g) => ({ k: g, label: g })) },
    { key: 'payout', label: 'Payout Frequency', opts: [...payouts].sort().map((p) => ({ k: p, label: p })) },
    { key: 'tax', label: 'Tax Status', opts: [...taxes].sort().map((t) => ({ k: t, label: titleCase(t) })) },
    { key: 'collateral', label: 'Collateral', opts: [...colls].sort().map((c) => ({ k: c, label: titleCase(c) })) },
  ];
}
