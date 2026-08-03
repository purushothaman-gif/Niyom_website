/**
 * PortfolioService
 * -----------------------------------------------------------------------------
 * Pure, product-agnostic aggregation. Given raw holdings/transactions it derives
 * the REAL view models the dashboard renders. No I/O, no React — trivially
 * unit-testable, and every aggregate spans ALL products so Bonds / FD / Insurance
 * require zero changes here when they go live.
 */
import type { NWHolding, NWTransaction, ProductType } from '../../crm/types';
import type { PortalHolding } from '../types/cas';
import { PRODUCT_LABELS, PRODUCT_CHART_COLORS } from '../../crm/utils';
import { ASSET_CLASS_COLOR, paletteColor } from './palette';
import { MF_OWNERSHIP } from '../types/ownership';
import type {
  AllocationBucket,
  AllocationDimension,
  AllocationSlice,
  AssetClass,
  HoldingRow,
  MutualFundLine,
  MutualFundSummary,
  PortfolioData,
  PortfolioSummary,
  RecentTransaction,
} from '../types';

const holdingValue = (h: NWHolding): number => h.current_value || 0;
const holdingInvested = (h: NWHolding): number => h.invested_amount || 0;

const pct = (part: number, whole: number): number =>
  whole > 0 ? (part / whole) * 100 : 0;

const titleCase = (s: string): string =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** Broad asset class from product type + (for MF) scheme type. */
function assetClassOf(h: NWHolding): AssetClass {
  switch (h.product_type) {
    case 'secondary_bond':
    case 'primary_bond':
    case 'fixed_deposit':
      return 'Debt';
    case 'insurance':
      return 'Insurance';
    case 'unlisted_share':
      return 'Equity';
    case 'mutual_fund': {
      // A CAS states no scheme category, so fall back to the scheme name, which
      // reliably carries it ("… Liquid Fund", "… Balanced Advantage"). Without
      // this every imported holding would take the Equity default, and a
      // client's debt allocation would read as zero.
      const s = (h.scheme_type || h.product_name || '').toLowerCase();
      if (/hybrid|balanced|multi[- ]?asset|advantage/.test(s)) return 'Hybrid';
      if (/debt|liquid|gilt|bond|money|overnight|income|duration/.test(s)) return 'Debt';
      if (/equity|flexi|large|mid|small|index|elss|value|focus|cap/.test(s)) return 'Equity';
      return 'Equity';
    }
    default:
      return 'Other';
  }
}

/** Category label used for the category breakdown. */
function categoryOf(h: NWHolding): string {
  // Imported funds have no stated category, and bucketing them all as
  // "Uncategorised" would make the breakdown one meaningless slice — the asset
  // class is coarser but true.
  if (h.product_type === 'mutual_fund') return h.scheme_type ? titleCase(h.scheme_type) : assetClassOf(h);
  if (h.product_type === 'insurance') return h.insurance_type ? titleCase(h.insurance_type) : 'Insurance';
  return PRODUCT_LABELS[h.product_type];
}

/** Product-specific secondary line for the holdings table. */
function metaOf(h: NWHolding): string | undefined {
  switch (h.product_type) {
    case 'mutual_fund':
      return h.folio_number ? `Folio ${h.folio_number}` : h.fund_house || undefined;
    case 'secondary_bond':
    case 'primary_bond':
      return h.coupon_rate ? `${h.coupon_rate}% coupon` : h.isin || undefined;
    case 'fixed_deposit':
      return h.coupon_rate ? `${h.coupon_rate}% p.a.` : undefined;
    case 'insurance':
      return h.policy_number ? `Policy ${h.policy_number}` : h.insurer_name || undefined;
    default:
      return undefined;
  }
}

export const PortfolioService = {
  /** Top-line wealth summary + six-way allocation, across every product. */
  buildSummary(holdings: NWHolding[]): PortfolioSummary {
    const netWorth = holdings.reduce((s, h) => s + holdingValue(h), 0);
    const invested = holdings.reduce((s, h) => s + holdingInvested(h), 0);
    const gain = netWorth - invested;

    const productTypes = [...new Set(holdings.map((h) => h.product_type))];
    const allocation: AllocationSlice[] = productTypes
      .map((pt) => {
        const rows = holdings.filter((h) => h.product_type === pt);
        const value = rows.reduce((s, h) => s + holdingValue(h), 0);
        return {
          productType: pt,
          label: PRODUCT_LABELS[pt] ?? pt,
          color: PRODUCT_CHART_COLORS[pt] ?? '#94a0b3',
          value,
          percent: pct(value, netWorth),
          holdings: rows.length,
        };
      })
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value);

    return {
      netWorth,
      invested,
      gain,
      gainPercent: pct(gain, invested),
      holdingsCount: holdings.length,
      productCount: allocation.length,
      allocation,
    };
  },

  /** Mutual-fund-only rollup with the top holdings by current value. */
  buildMutualFundSummary(holdings: NWHolding[]): MutualFundSummary {
    const mf = holdings.filter((h) => h.product_type === 'mutual_fund');
    const value = mf.reduce((s, h) => s + holdingValue(h), 0);
    const invested = mf.reduce((s, h) => s + holdingInvested(h), 0);
    const gain = value - invested;

    const topFunds: MutualFundLine[] = mf
      .slice(0, 3)
      .map((h) => {
        const v = holdingValue(h);
        const inv = holdingInvested(h);
        return {
          name: h.product_name,
          fundHouse: h.fund_house,
          folioNumber: h.folio_number,
          value: v,
          invested: inv,
          gain: v - inv,
          gainPercent: pct(v - inv, inv),
        };
      });

    const folios = new Set(mf.map((h) => h.folio_number).filter(Boolean));

    return {
      value,
      invested,
      gain,
      gainPercent: pct(gain, invested),
      folioCount: folios.size,
      topFunds,
    };
  },

  /** Map recent transactions into lightweight dashboard rows. */
  buildRecentTransactions(txns: NWTransaction[], limit = 5): RecentTransaction[] {
    return txns.slice(0, limit).map((t) => ({
      id: t.id,
      productType: t.product_type as ProductType,
      productName: t.product_name,
      txnType: t.txn_type,
      amount: t.consolidated_amount || 0,
      date: t.txn_date,
    }));
  },

  /** Normalize every holding into a product-agnostic table row (Phase 2). */
  buildHoldingRows(holdings: PortalHolding[]): HoldingRow[] {
    return holdings
      .map((h) => {
        const value = holdingValue(h);
        const invested = holdingInvested(h);
        const gain = value - invested;
        return {
          id: h.id,
          /*
           * A statement names the distributor outright, so it decides. Failing
           * that, a mutual fund in nw_holdings is one WE sold — that is the only
           * way a row gets there — so it sits under our ARN. Every other asset
           * class has no such notion and stays undefined.
           */
          ownership:
            h.cas?.ownership ??
            (h.product_type === 'mutual_fund' ? MF_OWNERSHIP.heldWithNiyom : undefined),
          cas: h.cas,
          productType: h.product_type,
          productLabel: PRODUCT_LABELS[h.product_type] ?? h.product_type,
          productColor: PRODUCT_CHART_COLORS[h.product_type] ?? '#7688A4',
          name: h.product_name,
          meta: metaOf(h),
          assetClass: assetClassOf(h),
          category: categoryOf(h),
          amc: h.fund_house || undefined,
          units: h.quantity || undefined,
          invested,
          value,
          gain,
          gainPercent: pct(gain, invested),
        };
      })
      .sort((a, b) => b.value - a.value);
  },

  /**
   * Generic allocation breakdown along one dimension. `keyOf` returns a stable
   * grouping key + display label; colors come from the caller so product keeps
   * its brand colors while category/AMC use the shared palette.
   */
  buildBreakdown(
    rows: HoldingRow[],
    id: AllocationDimension['id'],
    title: string,
    keyOf: (r: HoldingRow) => { key: string; label: string; color?: string },
  ): AllocationDimension {
    const total = rows.reduce((s, r) => s + r.value, 0);
    const map = new Map<string, { label: string; color?: string; value: number; count: number }>();

    for (const r of rows) {
      const { key, label, color } = keyOf(r);
      const entry = map.get(key) ?? { label, color, value: 0, count: 0 };
      entry.value += r.value;
      entry.count += 1;
      map.set(key, entry);
    }

    const buckets: AllocationBucket[] = [...map.entries()]
      .map(([key, e]) => ({
        key,
        label: e.label,
        color: e.color ?? '#7688A4',
        value: e.value,
        percent: pct(e.value, total),
        count: e.count,
      }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((b, i) => ({ ...b, color: b.color === '#7688A4' ? paletteColor(i) : b.color }));

    return { id, title, buckets, total };
  },

  /** Full aggregate for the Portfolio & Allocation pages. */
  buildPortfolioData(holdings: PortalHolding[]): PortfolioData {
    const rows = this.buildHoldingRows(holdings);
    return {
      summary: this.buildSummary(holdings),
      rows,
      breakdowns: {
        product: this.buildBreakdown(rows, 'product', 'By Product', (r) => ({
          key: r.productType,
          label: r.productLabel,
          color: r.productColor,
        })),
        assetClass: this.buildBreakdown(rows, 'assetClass', 'By Asset Class', (r) => ({
          key: r.assetClass,
          label: r.assetClass,
          color: ASSET_CLASS_COLOR[r.assetClass],
        })),
        category: this.buildBreakdown(rows, 'category', 'By Category', (r) => ({
          key: r.category ?? 'Uncategorised',
          label: r.category ?? 'Uncategorised',
        })),
        amc: this.buildBreakdown(
          rows.filter((r) => r.amc),
          'amc',
          'By AMC / Issuer',
          (r) => ({ key: r.amc as string, label: r.amc as string }),
        ),
      },
    };
  },
};
