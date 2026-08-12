/**
 * FundService
 * -----------------------------------------------------------------------------
 * Read-side domain facade over the BSE scheme master. Pure query helpers
 * (search / filter / sort / facets) — no I/O, no React. The UI calls these on
 * the schemes it already loaded via BSEService, keeping filtering instant and
 * testable.
 */
import type { FundCategory, FundFilters, FundScheme, RiskLevel } from '../types/funds';

const RISK_ORDER: RiskLevel[] = [
  'Low',
  'Moderately Low',
  'Moderate',
  'Moderately High',
  'High',
  'Very High',
];

export interface FundFacets {
  categories: FundCategory[];
  amcs: string[];
  risks: RiskLevel[];
}

export const FundService = {
  /** Distinct filter options present in the catalog. */
  facets(schemes: FundScheme[]): FundFacets {
    return {
      categories: [...new Set(schemes.map((s) => s.category))].sort(),
      amcs: [...new Set(schemes.map((s) => s.amc))].sort(),
      risks: RISK_ORDER.filter((r) => schemes.some((s) => s.riskLevel === r)),
    };
  },

  /** Apply the discovery filters + sort. */
  apply(schemes: FundScheme[], f: FundFilters): FundScheme[] {
    const q = f.query.trim().toLowerCase();
    const filtered = schemes.filter((s) => {
      if (f.category !== 'all' && s.category !== f.category) return false;
      if (f.amc !== 'all' && s.amc !== f.amc) return false;
      if (f.risk !== 'all' && s.riskLevel !== f.risk) return false;
      if (q && !(`${s.name} ${s.amc} ${s.subCategory}`.toLowerCase().includes(q))) return false;
      return true;
    });

    const sorters: Record<FundFilters['sort'], (a: FundScheme, b: FundScheme) => number> = {
      returns1Y: (a, b) => b.returns['1Y'] - a.returns['1Y'],
      returns3Y: (a, b) => b.returns['3Y'] - a.returns['3Y'],
      aum: (a, b) => b.aum - a.aum,
      rating: (a, b) => b.rating - a.rating || b.returns['1Y'] - a.returns['1Y'],
      expense: (a, b) => a.expenseRatio - b.expenseRatio,
    };

    return [...filtered].sort(sorters[f.sort]);
  },
};
