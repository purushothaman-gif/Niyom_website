/**
 * Mutual Fund domain types (Phase 3)
 * -----------------------------------------------------------------------------
 * Presentation-facing fund + order models. These describe what the UI needs;
 * BSEService maps the (currently mocked) BSE StAR MF scheme master and order
 * API into these shapes, so the UI never depends on BSE's wire format.
 */

export type FundCategory = 'Equity' | 'Debt' | 'Hybrid' | 'Other';

/** SEBI riskometer levels, low → high. */
export type RiskLevel =
  | 'Low'
  | 'Moderately Low'
  | 'Moderate'
  | 'Moderately High'
  | 'High'
  | 'Very High';

export type FundPlan = 'Growth' | 'IDCW';

/** Trailing annualised returns (%). 1M/6M are absolute for the period. */
export interface FundReturns {
  '1M': number;
  '6M': number;
  '1Y': number;
  '3Y': number;
  '5Y': number;
}

/** A single scheme from the BSE scheme master. */
export interface FundScheme {
  /** BSE scheme code — the transactional identity. */
  schemeCode: string;
  name: string;
  amc: string;
  category: FundCategory;
  subCategory: string;
  riskLevel: RiskLevel;
  nav: number;
  navDate: string;
  returns: FundReturns;
  /** % expense ratio. */
  expenseRatio: number;
  /** Assets under management, in ₹ crore. */
  aum: number;
  minLumpsum: number;
  minSip: number;
  exitLoad: string;
  fundManager: string;
  benchmark: string;
  /** 1–5 star internal rating. */
  rating: number;
  plans: FundPlan[];
  /** Illustrative sample catalog until BSE scheme master is wired. */
  isMock: boolean;
}

/* --------------------------------- Discovery ------------------------------ */

export type FundSort = 'returns1Y' | 'returns3Y' | 'aum' | 'rating' | 'expense';

export interface FundFilters {
  query: string;
  category: FundCategory | 'all';
  amc: string | 'all';
  risk: RiskLevel | 'all';
  sort: FundSort;
}

export const DEFAULT_FUND_FILTERS: FundFilters = {
  query: '',
  category: 'all',
  amc: 'all',
  risk: 'all',
  sort: 'returns1Y',
};

/* ---------------------------------- Orders -------------------------------- */

export type OrderType = 'lumpsum' | 'sip';
export type SipFrequency = 'Monthly' | 'Quarterly';

export interface OrderRequest {
  schemeCode: string;
  clientId: string;
  type: OrderType;
  plan: FundPlan;
  amount: number;
  folioNumber?: string;
  /** SIP only */
  sipDay?: number;
  sipFrequency?: SipFrequency;
  installments?: number;
}

export interface OrderResult {
  orderId: string;
  schemeCode: string;
  schemeName: string;
  type: OrderType;
  amount: number;
  status: 'confirmed';
  placedAt: string;
  /** NAV allotment date the units are expected against. */
  expectedNavDate: string;
  /** True while BSEService is mocked (no real money moved). */
  isMock: boolean;
  /**
   * BSE-hosted link the INVESTOR must approve. Until they do, the order sits at
   * mem_2fa 'p' and cannot even be paid for — so this is the next step, not an
   * optional extra.
   */
  twoFaUrl?: string | null;
}

/* ----------------------------- Redeem & Switch ---------------------------- */

export type RedeemMode = 'amount' | 'units' | 'all';

export interface RedemptionRequest {
  clientId: string;
  schemeCode?: string;
  schemeName: string;
  folioNumber?: string;
  mode: RedeemMode;
  /** ₹ value being redeemed (caller-computed, incl. for `all`). */
  amount: number;
  units: number;
}

export interface SwitchRequest {
  clientId: string;
  fromSchemeCode?: string;
  fromSchemeName: string;
  toSchemeCode: string;
  toSchemeName: string;
  folioNumber?: string;
  mode: RedeemMode;
  amount: number;
  units: number;
}

/** Shared confirmation for redeem/switch (non-purchase MF transactions). */
export interface TxnResult {
  orderId: string;
  kind: 'redeem' | 'switch';
  schemeName: string;
  /** Human summary line, e.g. "₹50,000 redeemed" or "Switched to X". */
  detail: string;
  amount: number;
  status: 'confirmed';
  placedAt: string;
  expectedNavDate: string;
  isMock: boolean;
}
