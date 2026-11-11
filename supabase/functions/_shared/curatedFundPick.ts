/**
 * Which scheme a curated fund name refers to — the pure half of
 * update-mutual-funds' resolver, kept here so it can be unit-tested.
 */

/** Letters and digits only, so "Flexicap", "Flexi Cap" and "UTI - Flexi Cap Fund." all agree. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

/**
 * Share classes and wrappers that carry a fund's name but are not the plan a
 * retail client buys: bonus options, institutional / PF / premium tiers, the
 * fund-of-funds and ETF built on it. Skipped unless the target itself asks.
 */
const VARIANT = /\b(bonus|institutional|pf|premium|retail|fof|etf|retirement|segregated)\b/i;

export interface SchemeCandidate {
  scheme_code: string;
  scheme_name: string;
}

/**
 * The scheme a curated name refers to, from LIVE Regular-Growth candidates.
 *
 * The old rule took the lowest scheme code whose name contained the target,
 * dead or alive. For several funds the lowest code is a discontinued
 * institutional plan frozen at a 2020 NAV — so the research page showed a fund
 * nobody can buy, at returns that stopped moving years ago. Now: an exact name
 * wins, then the plainest (shortest) name, then the lowest code, which is the
 * original plan when a fund has several live Regular-Growth codes.
 */
export function pickScheme(candidates: SchemeCandidate[], names: string[]): number | null {
  for (const wanted of names) {
    const key = nameKey(wanted);
    const allowVariant = VARIANT.test(wanted);
    const hits = candidates
      .filter((c) => nameKey(c.scheme_name).includes(key))
      .filter((c) => allowVariant || !VARIANT.test(c.scheme_name))
      .map((c) => ({ code: Number(c.scheme_code), exact: nameKey(c.scheme_name) === key, len: c.scheme_name.length }))
      .filter((c) => Number.isFinite(c.code))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || a.len - b.len || a.code - b.code);
    if (hits.length) return hits[0].code;
  }
  return null;
}
