/**
 * AMFI's category heading, split into the two things a research screen needs.
 *
 * Headings arrive exactly as AMFI publishes them, which is not one scheme:
 *
 *   "Equity Scheme - Large Cap Fund"      SEBI-era, since the 2018 recategorisation
 *   "Hybrid Scheme - Aggressive Hybrid Fund"
 *   "Other Scheme - Index Funds"
 *   "Income"                              pre-2018 headings AMFI never rewrote
 *   "Growth"
 *   "Income/Debt Oriented"
 *   "Fund of Funds"
 *
 * The modern form carries both halves around a dash. The legacy ones carry only
 * a broad class, and there is no honest way to invent a sub-category for them —
 * so they get an empty one and the UI renders the broad class instead. Guessing
 * "Large Cap" from a fund's NAME would be a fabrication a client could act on.
 *
 * Kept free of any Supabase import so both the CRM and the portal can use it
 * without dragging an auth client across that boundary (see crmFundCatalog).
 */

/** The broad shelves a client browses by. */
export type FundBucket = 'Equity' | 'Debt' | 'Hybrid' | 'Other';

export interface SplitCategory {
  bucket: FundBucket;
  /** e.g. "Large Cap Fund". Empty when AMFI's heading names no sub-category. */
  subCategory: string;
}

/*
 * Legacy headings, mapped to the shelf a client would look for them on.
 *
 * "Growth" is the pre-2018 word for an equity scheme, not a plan option — the
 * same word means something entirely different in a scheme NAME, which is why
 * this matches whole headings only and never substrings of one.
 */
const LEGACY: Record<string, FundBucket> = {
  growth: 'Equity',
  elss: 'Equity',
  'equity scheme': 'Equity',
  income: 'Debt',
  'income/debt oriented': 'Debt',
  gilt: 'Debt',
  'gilt fund': 'Debt',
  'liquid/money market': 'Debt',
  balanced: 'Hybrid',
  'hybrid scheme': 'Hybrid',
};

/** Split an AMFI heading into a browsing shelf and a sub-category. */
export function splitAmfiCategory(heading: string | null | undefined): SplitCategory {
  const raw = (heading ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { bucket: 'Other', subCategory: '' };

  /*
   * The modern form: "<Class> Scheme - <Sub-category>".
   *
   * Schemes? because AMFI publishes BOTH spellings, sometimes for the same
   * shelf on the same day — "Equity Scheme - Mid Cap Fund" for ICICI's midcap
   * and "Equity Schemes - Mid Cap Fund" for Invesco's. Matching only the
   * singular quietly dropped every plural-spelled scheme into Other with no
   * sub-category, which is invisible on screen but empties the collections
   * that match on it.
   */
  const modern = raw.match(/^(.+?)\s+Schemes?\s*-\s*(.+)$/i);
  if (modern) {
    return { bucket: toBucket(modern[1]), subCategory: modern[2].trim() };
  }

  // "<Class> Scheme" with nothing after it, and the legacy single-word forms.
  const withoutScheme = raw.replace(/\s+Schemes?$/i, '').trim();
  return { bucket: toBucket(withoutScheme), subCategory: '' };
}

function toBucket(cls: string): FundBucket {
  const k = cls.toLowerCase().trim();
  if (LEGACY[k]) return LEGACY[k];
  if (k === 'equity') return 'Equity';
  if (k === 'debt') return 'Debt';
  if (k === 'hybrid') return 'Hybrid';
  /*
   * Everything else — "Other Scheme" (index funds and ETFs), "Solution
   * Oriented" (retirement and children's funds), "Fund of Funds", "Life Cycle
   * Funds" — is left as Other rather than forced onto an equity or debt shelf.
   * An index fund's shelf depends on what it tracks, which the heading does not
   * say, and a retirement fund is sold on its lock-in rather than its asset mix.
   */
  return 'Other';
}
