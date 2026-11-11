/**
 * Explore: which bonds and funds earn a place on the "popular" rails.
 * -----------------------------------------------------------------------------
 * Pure ranking, no React and no database, so the app can run the same rules the
 * website's Explore page uses (src/portal/features/explore/ExploreHub.tsx still
 * carries its own copy of these; keep the two in step until that file imports
 * from here).
 */
import { ratingGrade } from '../portal/bonds/bondFilters';

export interface PickableBond {
  isin?: string | null;
  bond_name?: string | null;
  issuer_name?: string | null;
  coupon_rate: number | null;
  maturity_date: string | null;
  rating: string | null;
  analytics?: { ytm?: number | null } | null;
}

/** The yield a client is shown: YTM at today's offer price, else the coupon. */
export function bondYield(b: PickableBond): number | null {
  return b.analytics?.ytm ?? b.coupon_rate ?? null;
}

/** Credit grade bucket, best first: AAA 0 · AA 1 · A-category 2 · BBB and below 3. */
export function bondGradeRank(b: PickableBond): number {
  const g = ratingGrade(b.rating) ?? '';
  return g.startsWith('AAA') ? 0 : g.startsWith('AA') ? 1 : g.startsWith('A') ? 2 : 3;
}

const plainKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The "Popular Bonds" rail: one bond per issuer, good rating first, highest
 * yield first. It widens tier by tier (branded AA+, branded A, any AA+, the
 * rest) and stops once four are on the rail, so it is never empty while bonds
 * exist. `hasLogo` is optional: a surface with no issuer logos skips the two
 * branded tiers.
 */
export function curatedBonds<T extends PickableBond>(
  bonds: T[],
  opts: { hasLogo?: (b: T) => boolean; issuerKey?: (b: T) => string; n?: number; now?: Date } = {},
): T[] {
  const { hasLogo, n = 12, now = new Date() } = opts;
  const issuerOf =
    opts.issuerKey ?? ((b: T) => plainKey(b.issuer_name?.trim() || b.bond_name || b.isin || ''));
  const live = bonds.filter((b) => !b.maturity_date || new Date(b.maturity_date) > now);
  const byYield = (a: T, b: T) => (bondYield(b) ?? 0) - (bondYield(a) ?? 0);

  const tiers: Array<(b: T) => boolean> = [
    ...(hasLogo
      ? [(b: T) => hasLogo(b) && bondGradeRank(b) <= 1, (b: T) => hasLogo(b) && bondGradeRank(b) === 2]
      : []),
    (b) => bondGradeRank(b) <= 1,
    () => true,
  ];
  const out: T[] = [];
  const issuers = new Set<string>();
  for (const tier of tiers) {
    for (const b of live.filter(tier).sort(byYield)) {
      if (out.length >= n) break;
      const key = issuerOf(b);
      if (issuers.has(key)) continue;
      issuers.add(key);
      out.push(b);
    }
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Popular funds: staff picks first, then the leaders of each category list
 * taken round-robin (the best of each, then the second-best of each), so the
 * rail stays varied rather than one category deep. `lists` are already ranked.
 */
export function popularFunds<T extends { amfiCode: string }>(
  funds: T[],
  picks: string[],
  lists: T[][],
  n = 12,
): T[] {
  const byCode = new Map(funds.map((f) => [f.amfiCode, f]));
  const out = picks
    .map((c) => byCode.get(c))
    .filter((f): f is T => !!f)
    .slice(0, n);
  const seen = new Set(out.map((f) => f.amfiCode));
  for (let rank = 0; out.length < n && lists.some((l) => l.length > rank); rank++) {
    for (const l of lists) {
      const f = l[rank];
      if (f && !seen.has(f.amfiCode) && out.length < n) {
        seen.add(f.amfiCode);
        out.push(f);
      }
    }
  }
  return out;
}
