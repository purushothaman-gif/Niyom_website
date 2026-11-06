/**
 * Investments model
 * -----------------------------------------------------------------------------
 * One product-agnostic shape for "what do I hold and how is it doing", shared by
 * the client Wealth Portal and the Partner Portal so both render the same
 * holdings board from the same arithmetic.
 *
 * Honesty rules baked in here (not left to the UI):
 *   - `invested` is null when the cost basis is unknown. Registrar-fed mutual
 *     funds (CAMS/KFintech holdings feeds) report value and units but no cost,
 *     so their returns are UNKNOWN — never 0%. Totals for invested/returns are
 *     computed only over holdings whose cost is known, and the summary says how
 *     much of the portfolio that covers.
 *   - `dayChange` is null unless a real price move exists (published NAVs for
 *     mutual funds). Nothing is interpolated.
 */
import type { NWHolding } from '../../crm/types';

/** The asset buckets the board tabs on. */
export type AssetKey = 'mutual_fund' | 'bond' | 'unlisted_share' | 'other';

export const ASSET_META: Record<AssetKey, { label: string; short: string; color: string }> = {
  mutual_fund: { label: 'Mutual Funds', short: 'MF', color: '#EC4899' },
  bond: { label: 'Bonds', short: 'Bond', color: '#10B981' },
  unlisted_share: { label: 'Unlisted Shares', short: 'Unlisted', color: '#F59E0B' },
  other: { label: 'Others', short: 'Other', color: '#3B82F6' },
};

export const ASSET_ORDER: AssetKey[] = ['mutual_fund', 'bond', 'unlisted_share', 'other'];

export function assetOf(productType: string): AssetKey {
  if (productType === 'mutual_fund') return 'mutual_fund';
  if (productType === 'secondary_bond' || productType === 'primary_bond') return 'bond';
  if (productType === 'unlisted_share') return 'unlisted_share';
  return 'other';
}

export interface InvestmentRow {
  id: string;
  asset: AssetKey;
  productType: string;
  name: string;
  /** Secondary line: folio, ISIN, client name… */
  sub?: string;
  units: number | null;
  /** Average cost per unit, when the cost basis is known. */
  avgPrice: number | null;
  /** Current price per unit (NAV / share price / bond price). */
  price: number | null;
  invested: number | null;
  value: number;
  gain: number | null;
  gainPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  /** Where the figure comes from — shown on the detail panel. */
  source: 'registrar' | 'niyom' | 'statement';
  /**
   * Mutual funds read from a CAS: which distributor the holding sits with.
   * Absent for everything else (we sold it, so it is ours).
   */
  distributor?: 'niyom' | 'other' | 'unknown';

  /* Mutual funds */
  amc?: string | null;
  category?: string | null;
  fundReturn1y?: number | null;
  fundReturn3y?: number | null;
  navDate?: string | null;
  folio?: string | null;

  /* Bonds */
  coupon?: number | null;
  maturity?: string | null;
  payoutFrequency?: string | null;
  nextPayout?: string | null;
  isin?: string | null;
  faceValue?: number | null;

  /* Insurance / FD — kept for completeness */
  issuer?: string | null;
}

export interface AssetSlice {
  asset: AssetKey;
  label: string;
  color: string;
  value: number;
  percent: number;
  count: number;
}

export interface InvestmentSummary {
  current: number;
  /** Sum of invested over rows whose cost basis is known. */
  invested: number;
  /** Gain over the same known-cost subset. */
  returns: number;
  returnsPct: number | null;
  /** Value covered by a known cost basis, 0–100. */
  costCoveragePct: number;
  /** Rows with unknown cost, for the explanatory footnote. */
  unknownCostCount: number;
  dayChange: number | null;
  dayChangePct: number | null;
  count: number;
  slices: AssetSlice[];
}

const safePct = (part: number, whole: number): number | null =>
  whole > 0 ? (part / whole) * 100 : null;

export function summarise(rows: InvestmentRow[]): InvestmentSummary {
  const current = rows.reduce((s, r) => s + r.value, 0);
  const known = rows.filter((r) => r.invested != null);
  const invested = known.reduce((s, r) => s + (r.invested ?? 0), 0);
  const knownValue = known.reduce((s, r) => s + r.value, 0);
  const returns = knownValue - invested;

  const moved = rows.filter((r) => r.dayChange != null);
  const dayChange = moved.length ? moved.reduce((s, r) => s + (r.dayChange ?? 0), 0) : null;
  const movedValue = moved.reduce((s, r) => s + r.value, 0);
  const dayChangePct =
    dayChange != null && movedValue - dayChange > 0 ? (dayChange / (movedValue - dayChange)) * 100 : null;

  const slices: AssetSlice[] = ASSET_ORDER.map((asset) => {
    const rs = rows.filter((r) => r.asset === asset);
    const value = rs.reduce((s, r) => s + r.value, 0);
    return {
      asset,
      label: ASSET_META[asset].label,
      color: ASSET_META[asset].color,
      value,
      percent: safePct(value, current) ?? 0,
      count: rs.length,
    };
  }).filter((s) => s.count > 0);

  return {
    current,
    invested,
    returns,
    returnsPct: known.length ? safePct(returns, invested) : null,
    costCoveragePct: safePct(knownValue, current) ?? 0,
    unknownCostCount: rows.length - known.length,
    dayChange,
    dayChangePct,
    count: rows.length,
    slices,
  };
}

/* ---------------------------------------------------------------------------
 * Adapters
 * ------------------------------------------------------------------------- */

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function gainOf(invested: number | null, value: number) {
  if (invested == null) return { gain: null, gainPct: null };
  const gain = value - invested;
  return { gain, gainPct: invested > 0 ? (gain / invested) * 100 : null };
}

/** Next coupon date on/after today from a payout date + frequency, best-effort. */
export function nextPayoutDate(
  anchor: string | null | undefined,
  frequency: string | null | undefined,
  maturity: string | null | undefined,
  today = new Date(),
): string | null {
  if (!anchor) return null;
  const d = new Date(anchor);
  if (Number.isNaN(d.getTime())) return null;
  const f = (frequency || '').toLowerCase();
  const step = /month/.test(f) ? 1 : /quarter/.test(f) ? 3 : /half|semi/.test(f) ? 6 : /annual|year/.test(f) ? 12 : 0;
  const end = maturity ? new Date(maturity) : null;
  if (step === 0) return d >= today ? anchor.slice(0, 10) : null;
  let guard = 0;
  while (d < today && guard++ < 600) d.setMonth(d.getMonth() + step);
  if (end && !Number.isNaN(end.getTime()) && d > end) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Client-portal holdings → rows. Registrar MF rows (id `rta-…`) carry no cost
 * basis; HoldingService sets invested = value for them, which must NOT be read
 * as "0% return".
 */
export function fromClientHoldings(
  holdings: Array<NWHolding & { cas?: { ownership?: string } | null }>,
): InvestmentRow[] {
  return holdings
    .map((h) => {
      const registrar = h.product_type === 'mutual_fund' && String(h.id).startsWith('rta-');
      const own = h.cas?.ownership;
      const distributor: InvestmentRow['distributor'] = !h.cas
        ? undefined
        : own === 'held_with_niyom'
          ? 'niyom'
          : own === 'held_away'
            ? 'other'
            : 'unknown';
      const value = n(h.current_value);
      // A registrar-fed fund shows a return only when we actually know its cost
      // (a CAS-bridged or transaction-derived cost sets avg_cost > 0); without it
      // invested stays null so no invented gain appears.
      const invested =
        registrar && !(n(h.avg_cost) > 0) ? null : n(h.invested_amount);
      const units = h.quantity ? n(h.quantity) : null;
      const asset = assetOf(h.product_type);
      const price =
        h.product_type === 'mutual_fund'
          ? h.current_nav != null ? n(h.current_nav) : units ? value / units : null
          : units ? value / units : null;
      const avgPrice = invested != null && units ? invested / units : null;
      return {
        id: h.id,
        asset,
        productType: h.product_type,
        name: h.product_name,
        sub:
          asset === 'mutual_fund'
            ? h.folio_number ? `Folio ${h.folio_number}` : undefined
            : asset === 'bond'
              ? h.isin || h.issuer_name || undefined
              : undefined,
        units,
        avgPrice,
        price,
        invested,
        value,
        ...gainOf(invested, value),
        dayChange: null,
        dayChangePct: null,
        source: registrar ? 'registrar' : h.cas ? 'statement' : 'niyom',
        distributor,
        amc: h.fund_house || null,
        category: h.scheme_type || null,
        navDate: h.nav_date || null,
        folio: h.folio_number || null,
        coupon: h.coupon_rate != null && n(h.coupon_rate) > 0 ? n(h.coupon_rate) : null,
        maturity: h.maturity_date || null,
        payoutFrequency: h.payout_frequency || null,
        nextPayout:
          asset === 'bond'
            ? nextPayoutDate(h.interest_payout_date, h.payout_frequency, h.maturity_date)
            : null,
        isin: h.isin || null,
        faceValue: h.face_value != null ? n(h.face_value) : null,
        issuer: h.issuer_name || h.insurer_name || null,
      } satisfies InvestmentRow;
    })
    .sort((a, b) => b.value - a.value);
}

/** Shape of a partner-RPC holding (mirrors PartnerHoldingRow). */
export interface PartnerHoldingLike {
  holding_id: string;
  product_type: string;
  product_name: string;
  quantity: number;
  avg_price: number;
  invested_amount: number;
  current_value: number;
  gain_loss: number;
}

/**
 * Partner-RPC holdings → rows. `registrarMf` = mutual funds come from the
 * registrar feed (MF on platform), whose invested figure is a stand-in for value.
 */
export function fromPartnerHoldings(
  rows: PartnerHoldingLike[],
  opts: { registrarMf: boolean; clientName?: string; clientId?: string },
): InvestmentRow[] {
  return rows
    .map((h) => {
      const registrar = opts.registrarMf && h.product_type === 'mutual_fund';
      const value = n(h.current_value);
      const invested = registrar ? null : n(h.invested_amount);
      const units = h.quantity ? n(h.quantity) : null;
      return {
        id: opts.clientId ? `${opts.clientId}:${h.holding_id}` : h.holding_id,
        asset: assetOf(h.product_type),
        productType: h.product_type,
        name: h.product_name,
        sub: opts.clientName,
        units,
        avgPrice: invested != null && h.avg_price ? n(h.avg_price) : null,
        price: units ? value / units : null,
        invested,
        value,
        ...gainOf(invested, value),
        dayChange: null,
        dayChangePct: null,
        source: registrar ? 'registrar' : 'niyom',
      } satisfies InvestmentRow;
    })
    .sort((a, b) => b.value - a.value);
}

/** Registrar MF holdings (mf_rta_holdings) → rows. No cost basis by nature. */
export function fromRtaHoldings(
  holdings: Array<{
    id: string;
    folio: string;
    schemeName: string | null;
    schemeCode: string;
    amcCode: string | null;
    units: number;
    rtaValue: number | null;
    nav: number | null;
    navValue: number | null;
    snapshotDate: string | null;
  }>,
): InvestmentRow[] {
  return holdings
    .map((h) => {
      const value = h.rtaValue ?? h.navValue ?? (h.nav != null ? h.units * h.nav : 0);
      return {
        id: `rta-${h.id}`,
        asset: 'mutual_fund' as const,
        productType: 'mutual_fund',
        name: h.schemeName ?? h.schemeCode,
        sub: `Folio ${h.folio}`,
        units: h.units || null,
        avgPrice: null,
        price: h.nav ?? (h.units ? value / h.units : null),
        invested: null,
        value,
        gain: null,
        gainPct: null,
        dayChange: null,
        dayChangePct: null,
        source: 'registrar' as const,
        folio: h.folio,
        navDate: h.snapshotDate,
      } satisfies InvestmentRow;
    })
    .sort((a, b) => b.value - a.value);
}
