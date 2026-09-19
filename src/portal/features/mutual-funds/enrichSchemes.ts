/**
 * Enrich the BSE scheme master with real NAV + trailing returns.
 * -----------------------------------------------------------------------------
 * The "All schemes" tab is the BSE scheme master — the catalog we can actually
 * place orders against — but that master carries no live NAV and no returns, so
 * every card read ₹0.00 / +0.0% / AUM ₹0. Those figures live in the AMFI
 * universe (`mf_scheme_cache`, surfaced as CatalogFund), keyed by AMFI code.
 *
 * Nothing joins the two catalogs but the fund's name, so this reuses the same
 * conservative CORE-name match the invest flow already trusts to resolve a
 * research fund back to its orderable BSE scheme (see explore/schemeMatch). A
 * matched scheme borrows the universe's NAV and returns; an unmatched one has
 * its fabricated zeros blanked to null so the card shows an em dash rather than
 * a number nobody can stand behind.
 *
 * Only display fields (nav, navDate, returns) are touched — schemeCode, plans
 * and the order minimums that drive the transaction are left exactly as BSE
 * gave them.
 */
import type { CatalogFund, FundScheme } from '../../types/funds';
import { coreName } from './explore/schemeMatch';

const BLANK_RETURNS: FundScheme['returns'] = {
  '1M': null,
  '6M': null,
  '1Y': null,
  '3Y': null,
  '5Y': null,
};

export function enrichSchemesWithUniverse(
  schemes: FundScheme[],
  universe: CatalogFund[],
): FundScheme[] {
  if (!universe.length) return schemes;

  // coreName → universe fund. The universe is one canonical (Direct-plan) row
  // per fund, so collisions are rare; first writer wins.
  const byCore = new Map<string, CatalogFund>();
  for (const u of universe) {
    const c = coreName(u.name);
    if (c && !byCore.has(c)) byCore.set(c, u);
  }

  return schemes.map((s) => {
    const u = byCore.get(coreName(s.name));
    if (!u) {
      // No match: drop the fabricated zeros so nothing false is shown.
      return s.nav === 0 ? { ...s, returns: BLANK_RETURNS } : { ...s, nav: 0, returns: BLANK_RETURNS };
    }
    return {
      ...s,
      nav: u.nav ?? 0,
      navDate: u.navDate ?? s.navDate,
      returns: {
        '1M': null, // AMFI trailing set has no 1-month figure.
        '6M': u.returns['6M'],
        '1Y': u.returns['1Y'],
        '3Y': u.returns['3Y'],
        '5Y': u.returns['5Y'],
      },
    };
  });
}
