/**
 * Portal view models
 * -----------------------------------------------------------------------------
 * The Wealth Portal never renders raw DB rows. Services map the CRM entities
 * (NWClient / NWHolding / NWTransaction) into these presentation-facing view
 * models, so the UI depends on a stable, product-agnostic shape.
 *
 * Anything sourced from a real table is marked REAL; anything stubbed until a
 * backend feed exists is marked MOCK and carries `isMock: true` so the UI can
 * render an honest indicator.
 */
import type { ProductType } from '../../crm/types';
import type { CasHoldingMeta } from './cas';
import type { MfOwnership } from './ownership';

/** A single row on the six-way asset-allocation ring. */
export interface AllocationSlice {
  productType: ProductType;
  label: string;
  /** Vivid, theme-constant hex (from PRODUCT_CHART_COLORS). */
  color: string;
  value: number;
  /** 0–100, share of net worth. */
  percent: number;
  holdings: number;
}

/** Top-line wealth aggregates — REAL, computed across every product. */
export interface PortfolioSummary {
  netWorth: number;
  invested: number;
  gain: number;
  gainPercent: number;
  holdingsCount: number;
  productCount: number;
  allocation: AllocationSlice[];
}

/** Mutual-fund-only rollup for the dashboard MF card — REAL. */
export interface MutualFundSummary {
  value: number;
  invested: number;
  gain: number;
  gainPercent: number;
  folioCount: number;
  topFunds: MutualFundLine[];
}

export interface MutualFundLine {
  name: string;
  fundHouse?: string;
  folioNumber?: string;
  value: number;
  invested: number;
  gain: number;
  gainPercent: number;
}

/** A recent transaction row for the dashboard — REAL when present. */
export interface RecentTransaction {
  id: string;
  productType: ProductType;
  productName: string;
  txnType: 'buy' | 'sell';
  amount: number;
  date: string;
}

/* ---------------------------------------------------------------------------
 * MOCK view models — replaced by real feeds (BSE NAV, goals, SIP mandates,
 * notices) in later phases. Every one carries isMock so the UI stays honest.
 * ------------------------------------------------------------------------- */

/** Intraday movement — MOCK until BSE NAV / index feed lands. */
export interface DailyChange {
  amount: number;
  percent: number;
  asOf: string;
  isMock: boolean;
}

/** Portfolio XIRR — MOCK until a cashflow-based engine lands. */
export interface XirrEstimate {
  percent: number;
  isMock: boolean;
}

export interface UpcomingSip {
  id: string;
  fundName: string;
  amount: number;
  nextDate: string;
  frequency: 'Monthly' | 'Quarterly' | 'Weekly';
  isMock: boolean;
}

export interface GoalProgress {
  id: string;
  name: string;
  target: number;
  current: number;
  /** 0–100 */
  percent: number;
  targetYear: number;
  isMock: boolean;
}

export interface MarketUpdate {
  id: string;
  label: string;
  value: string;
  changePercent: number;
  isMock: boolean;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  date: string;
  tone: 'info' | 'success' | 'warning';
  isMock: boolean;
}

/* ---------------------------------------------------------------------------
 * Portfolio & Allocation view models (Phase 2)
 * ------------------------------------------------------------------------- */

/** Broad asset class a holding rolls up to, derived from product + scheme. */
export type AssetClass = 'Equity' | 'Debt' | 'Hybrid' | 'Insurance' | 'Other';

/** A normalized, presentation-ready holding row spanning every product. */
export interface HoldingRow {
  id: string;
  productType: ProductType;
  productLabel: string;
  /** Vivid theme-constant hex for the product. */
  productColor: string;
  name: string;
  /** Product-specific secondary line (folio, coupon, ISIN, policy…). */
  meta?: string;
  assetClass: AssetClass;
  category?: string;
  amc?: string;
  units?: number;
  invested: number;
  value: number;
  gain: number;
  gainPercent: number;
  /**
   * Mutual funds only, and only once a statement has been imported: whether the
   * holding sits under our ARN. Absent for every other asset class, which has
   * no such notion — we sold it, so the question does not arise.
   */
  ownership?: MfOwnership;
  /**
   * The statement row behind this holding. Carried through to the UI so the
   * badge needs no second lookup, and so a future ARN migration can act on a
   * folio without re-reading the client's CAS.
   */
  cas?: CasHoldingMeta;
}

/** One slice of an allocation breakdown along a chosen dimension. */
export interface AllocationBucket {
  key: string;
  label: string;
  color: string;
  value: number;
  percent: number;
  count: number;
}

/** A full breakdown of the portfolio along one dimension. */
export interface AllocationDimension {
  id: 'product' | 'assetClass' | 'category' | 'amc';
  title: string;
  buckets: AllocationBucket[];
  total: number;
}

/** Aggregate for the Portfolio & Allocation pages. */
export interface PortfolioData {
  summary: PortfolioSummary;
  rows: HoldingRow[];
  breakdowns: Record<AllocationDimension['id'], AllocationDimension>;
}

/** Everything the Wealth Dashboard needs in one aggregate. */
export interface DashboardData {
  summary: PortfolioSummary;
  mutualFunds: MutualFundSummary;
  recentTransactions: RecentTransaction[];
  /**
   * Money-weighted return from the client's own cash flows, or null when it
   * cannot be computed. Null is meaningful — it means "not enough history",
   * which is different from a return of zero.
   */
  xirrPercent: number | null;
}
