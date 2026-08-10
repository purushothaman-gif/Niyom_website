/**
 * Curated fund → BSE scheme resolution.
 * -----------------------------------------------------------------------------
 * The two catalogs are keyed differently: the curated one by AMFI scheme code,
 * BSE's by its own scheme code. Nothing joins them but the fund's name, so this
 * is a name match — and a deliberately conservative one, because the output of
 * a bad match is an order placed in the wrong scheme.
 *
 * Rules:
 *   - Compare on a normalised CORE name: plan/option words removed ("direct",
 *     "regular", "growth", "idcw", …), punctuation dropped, "and" folded.
 *   - Require the cores to be equal. Substring matching is what turns
 *     "HDFC Small Cap Fund" into "HDFC Smart Small Cap", so it is not used.
 *   - Return every plan variant that matched, so the client picks the plan
 *     rather than us guessing between Direct and Regular, Growth and IDCW.
 */
import type { CatalogFund, FundScheme } from '../../../types/funds';
import { isDirectPlan } from '../../../../../supabase/functions/_shared/mfPlan';

const NOISE = [
  'direct',
  'regular',
  'plan',
  'option',
  'growth',
  'idcw',
  'dividend',
  'payout',
  'reinvestment',
  'reinvest',
  'fund',
  'scheme',
  'mutual',
  'the',
];

/** Lowercase, strip plan/option words and punctuation, collapse whitespace. */
export function coreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NOISE.includes(w))
    .join(' ')
    .trim();
}

/**
 * How a BSE scheme's plan reads to a client, for the plan picker.
 *
 * Only Regular reaches this — matchingSchemes drops Direct — so the plan half
 * is constant and the picker exists to choose Growth vs IDCW.
 */
export function planLabel(scheme: FundScheme): string {
  const option = /idcw|dividend/i.test(scheme.name) ? 'IDCW' : 'Growth';
  return `Regular · ${option}`;
}

/**
 * Every BSE scheme that is the same fund as `fund`. Empty when the scheme
 * master we hold has no match — the caller then says so plainly instead of
 * offering an order it cannot place.
 */
export function matchingSchemes(fund: CatalogFund, schemes: FundScheme[]): FundScheme[] {
  const core = coreName(fund.name);
  if (!core) return [];
  /*
   * Direct plans are excluded from what a client can order.
   *
   * This is the transaction path, so it is the one place where showing Direct
   * would not merely mislead but produce an order NIYOM cannot place as an ARN
   * distributor. The plan picker used to offer "Direct · Growth" alongside
   * Regular precisely because it listed every variant it matched.
   */
  return schemes.filter((s) => coreName(s.name) === core && !isDirectPlan(s.name));
}
