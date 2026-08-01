/**
 * Fund collections — the "what kind of fund do I want" entry points.
 * -----------------------------------------------------------------------------
 * Each collection is a predicate over the curated catalog plus the order the
 * list should arrive in. They are DERIVED, never hand-picked: a collection says
 * "these are the small-cap funds we track, best 3-year first", which is a fact
 * about the catalog. Opinions live in the recommendations shelf instead, where
 * a human signs for them.
 *
 * A collection with nothing in it is not rendered, so the grid tracks whatever
 * the curated table actually holds rather than promising categories we do not
 * cover yet.
 */
import {
  Building2,
  Coins,
  Flame,
  Gauge,
  Landmark,
  LineChart,
  Layers,
  PiggyBank,
  Scale,
  Shield,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { CatalogFund, CatalogReturns } from '../../../types/funds';

export type ReturnKey = keyof CatalogReturns;

/** A return value, or null when that period is not covered yet. */
export const ret = (f: CatalogFund, key: ReturnKey): number | null => f.returns[key];

/** Sort by a return period, funds without that history last. */
export const byReturn =
  (key: ReturnKey) =>
  (a: CatalogFund, b: CatalogFund): number => {
    const x = ret(a, key);
    const y = ret(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  };

export interface FundCollection {
  id: string;
  label: string;
  /** One line under the title on the collection page. */
  blurb: string;
  icon: LucideIcon;
  match: (f: CatalogFund) => boolean;
  /** Default ordering on the collection page. */
  sort: (a: CatalogFund, b: CatalogFund) => number;
  /**
   * Cap for collections defined by rank rather than by kind. "High return" has
   * to stop somewhere or it is just the whole catalog re-sorted, which tells a
   * client nothing.
   */
  limit?: number;
}

const sub = (f: CatalogFund) => f.subCategory.toLowerCase();

export const FUND_COLLECTIONS: FundCollection[] = [
  {
    id: 'high-return',
    label: 'High return',
    blurb: 'The 12 strongest 3-year annualised returns among the funds we track.',
    icon: Flame,
    match: (f) => ret(f, '3Y') !== null,
    sort: byReturn('3Y'),
    limit: 12,
  },
  {
    id: 'large-cap',
    label: 'Large cap',
    blurb: 'India’s biggest listed companies — the steadier end of equity.',
    icon: Building2,
    match: (f) => sub(f).includes('large') && !sub(f).includes('mid'),
    sort: byReturn('3Y'),
  },
  {
    id: 'mid-cap',
    label: 'Mid cap',
    blurb: 'Mid-sized companies: more room to grow, more to sit through.',
    icon: TrendingUp,
    match: (f) => sub(f).includes('mid'),
    sort: byReturn('3Y'),
  },
  {
    id: 'small-cap',
    label: 'Small cap',
    blurb: 'The most volatile equity shelf. Long horizons only.',
    icon: Sparkles,
    match: (f) => sub(f).includes('small'),
    sort: byReturn('3Y'),
  },
  {
    id: 'flexi-cap',
    label: 'Flexi & multi cap',
    blurb: 'One fund, free to move across large, mid and small caps.',
    icon: Layers,
    match: (f) => sub(f).includes('flexi') || sub(f).includes('multi cap'),
    sort: byReturn('3Y'),
  },
  {
    id: 'tax-saver',
    label: 'Tax saver (ELSS)',
    blurb: 'Section 80C deduction, with a three-year lock-in on every instalment.',
    icon: Shield,
    match: (f) => sub(f).includes('elss'),
    sort: byReturn('3Y'),
  },
  {
    id: 'index',
    label: 'Index funds',
    blurb: 'Track the index instead of trying to beat it. Lowest running cost.',
    icon: LineChart,
    match: (f) => sub(f).includes('index'),
    sort: byReturn('3Y'),
  },
  {
    id: 'sectoral',
    label: 'Sectoral & thematic',
    blurb: 'Concentrated bets on one sector or theme. Satellite holdings, not core.',
    icon: Gauge,
    match: (f) => sub(f).includes('sectoral') || sub(f).includes('thematic'),
    sort: byReturn('3Y'),
  },
  {
    id: 'balanced',
    label: 'Balanced advantage',
    blurb: 'Equity and debt, rebalanced by the fund as markets move.',
    icon: Scale,
    match: (f) => sub(f).includes('balanced advantage') || sub(f).includes('dynamic asset'),
    sort: byReturn('3Y'),
  },
  {
    id: 'hybrid',
    label: 'Hybrid funds',
    blurb: 'A single fund holding both equity and debt in a fixed band.',
    icon: Coins,
    match: (f) => f.category === 'Hybrid',
    sort: byReturn('3Y'),
  },
  {
    id: 'debt',
    label: 'Debt funds',
    blurb: 'Bonds and government paper — income with far smaller swings.',
    icon: Landmark,
    match: (f) => f.category === 'Debt',
    sort: byReturn('3Y'),
  },
  {
    id: 'liquid',
    label: 'Park short-term money',
    blurb: 'Liquid and short-duration funds for money you may need soon.',
    icon: PiggyBank,
    match: (f) => sub(f).includes('liquid') || sub(f).includes('short duration'),
    sort: byReturn('1Y'),
  },
];

/** Funds in a collection, in its own order and within its cap. */
export function fundsIn(collection: FundCollection, funds: CatalogFund[]): CatalogFund[] {
  const rows = funds.filter(collection.match).sort(collection.sort);
  return collection.limit ? rows.slice(0, collection.limit) : rows;
}

export function collectionById(id: string): FundCollection | undefined {
  return FUND_COLLECTIONS.find((c) => c.id === id);
}

/** Free-text search across name, AMC and category. */
export function searchFunds(funds: CatalogFund[], query: string): CatalogFund[] {
  const q = query.trim().toLowerCase();
  if (!q) return funds;
  return funds.filter((f) =>
    `${f.name} ${f.amc} ${f.category} ${f.subCategory}`.toLowerCase().includes(q),
  );
}
