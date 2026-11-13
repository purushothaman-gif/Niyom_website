/**
 * ONE LIST, BY PRODUCT. The report does not print a section per data source.
 * Every holding, wherever we learned of it, becomes one row under its product
 * (Mutual Funds, Bonds, Stocks ...), with a "Held" column saying whether it is
 * with Niyom or outside and in what form. A holding known to two sources is
 * printed once (countedStatementRows).
 *
 * The printable client Portfolio Report ("Print PDF" on the CRM Portfolio page).
 *
 * The report used to be built from the in-house book (nw_holdings) alone. Once
 * mutual funds moved to the fund platform, a client whose money sits in the
 * registrar feed or in an imported statement had nothing in the book, and the
 * report printed four zeros under their name while the screen showed their
 * holdings. So this reads every source the screen reads, with the same
 * de-duplication (countedStatementRows), and the totals here are the ones on
 * the summary cards:
 *
 *   value    = book + registrar MF + counted statement rows
 *   invested = book cost + registrar cost + statement cost, with anything that
 *              has no cost entered at value so it adds nothing to gain/loss
 *
 * A registrar or demat holding without a cost prints "Not available" for cost
 * and gain — never ₹0 invested or a 0% gain nobody can support.
 *
 * Pure: data in, HTML string out. The page does the loading and the printing.
 */
import type { RtaHoldingRow } from '../../shared/mf/rtaMf';
import type { NWClient, NWHolding, ProductType } from './types';
import { fmtDate } from './utils';
import type { CasCrmScheme, CasCrmView } from './services/casClientView';
import type { DematCrmView } from './services/dematClientView';
import { countedStatementRows } from './services/statementTotals';


const BOND_TYPES: ProductType[] = ['secondary_bond', 'primary_bond', 'fixed_deposit'];
const DSA_PRICE_TYPES: ProductType[] = ['unlisted_share', 'secondary_bond', 'primary_bond'];
const PAYOUT_FREQ: Record<string, string> = { annual: 'Annual', halfyearly: 'Half-Yearly', quarterly: 'Quarterly', monthly: 'Monthly' };

/** Product categories, in print order. */
const CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'mutual_fund', label: 'Mutual Funds', color: '#DB2777' },
  { key: 'unlisted_share', label: 'Unlisted Shares', color: '#7C3AED' },
  { key: 'bond', label: 'Bonds', color: '#0891B2' },
  { key: 'gsec', label: 'Government Securities', color: '#6B7A99' },
  { key: 'equity', label: 'Stocks', color: '#2E9E8F' },
  { key: 'etf', label: 'ETFs', color: '#3E7CB1' },
  { key: 'fixed_deposit', label: 'Fixed Deposits', color: '#D97706' },
  { key: 'insurance', label: 'Insurance', color: '#EA580C' },
  { key: 'aif', label: 'AIFs', color: '#8E6FB3' },
  { key: 'nps', label: 'NPS', color: '#4C8C6B' },
  { key: 'other', label: 'Other Securities', color: '#7688A4' },
];
const BOOK_CATEGORY: Record<string, string> = {
  mutual_fund: 'mutual_fund', unlisted_share: 'unlisted_share', secondary_bond: 'bond', primary_bond: 'bond',
  fixed_deposit: 'fixed_deposit', insurance: 'insurance',
};
const DEMAT_CATEGORY: Record<string, string> = {
  equity: 'equity', etf: 'etf', corporate_bond: 'bond', gsec: 'gsec', aif: 'aif', nps: 'nps', demat_mf: 'mutual_fund', other: 'other',
};

/** One holding, whichever source it came from. */
export interface ReportRow {
  category: string;
  name: string;
  /** Second line under the name: folio, ISIN, coupon, policy ... */
  detail: string;
  /** Where and how it is held, e.g. "With Niyom · Folio". */
  held: string;
  quantity: number | null;
  price: number | null;
  /** null = no purchase cost on record. */
  invested: number | null;
  value: number;
}

export interface ReportCategory {
  key: string;
  label: string;
  color: string;
  rows: ReportRow[];
  value: number;
  /** Gain across rows with a known cost, or null when none has one. */
  gain: number | null;
}

export interface PortfolioReportInput {
  /** The client the report is for, or null for a whole-book print. */
  client: Pick<NWClient, 'full_name' | 'client_code'> | null;
  /** Product types to print from the book. */
  products: ProductType[];
  /** In-house book rows (already scoped the way the screen scopes them). */
  holdings: NWHolding[];
  /** Looks up a holding's client (for DSA pricing). */
  clientOf: (clientId: string) => Pick<NWClient, 'sourced_via'> | undefined;
  /** Annual coupon/interest income across the book. */
  annualInterest: number;
  /** Registrar-feed mutual funds. Pass [] when the feed is not counted. */
  registrar: RtaHoldingRow[];
  cas: CasCrmView | null;
  demat: DematCrmView | null;
  /** Ready-made <img>/<div> for the logo. */
  logoHtml: string;
  now: Date;
}

export interface PortfolioReportTotals {
  value: number;
  invested: number;
  gainLoss: number;
  /** Rows printed across every category. */
  rowCount: number;
  /** Holdings with no cost behind them (entered at value). */
  unknownCostCount: number;
}

type RowsInput = Pick<PortfolioReportInput, 'holdings' | 'registrar' | 'cas' | 'demat'> & Partial<Pick<PortfolioReportInput, 'products' | 'clientOf' | 'client'>>;

export const registrarValueOf = (h: RtaHoldingRow): number => h.rtaValue ?? h.navValue ?? 0;

/** What registrar funds add to "invested": their cost, or their value when unknown. */
export function registrarInvested(rows: RtaHoldingRow[]): number {
  return rows.reduce((s, h) => s + (h.investedCost ?? registrarValueOf(h)), 0);
}

const join = (parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(' · ');

/** Every holding from every source, once each, grouped by product. */
export function buildReportCategories(input: RowsInput): ReportCategory[] {
  const rows: ReportRow[] = [];

  const products = input.products;
  for (const h of input.holdings) {
    if (products && !products.includes(h.product_type)) continue;
    const pt = h.product_type;
    const isDsa = input.clientOf?.(h.client_id)?.sourced_via === 'dsa' && DSA_PRICE_TYPES.includes(pt);
    const joined = (h as NWHolding & { client?: { full_name?: string } }).client;
    rows.push({
      category: BOOK_CATEGORY[pt] ?? 'other',
      name: h.product_name,
      detail: join([
        !input.client && joined?.full_name,
        pt === 'primary_bond' && 'Primary issue',
        h.isin && `ISIN ${h.isin}`,
        BOND_TYPES.includes(pt) && h.coupon_rate ? `${h.coupon_rate}% ${PAYOUT_FREQ[h.payout_frequency || 'annual'] || ''}`.trim() : '',
        BOND_TYPES.includes(pt) && h.maturity_date ? `Matures ${fmtDate(h.maturity_date)}` : '',
        pt === 'mutual_fund' && h.folio_number ? `Folio ${h.folio_number}` : '',
        pt === 'insurance' && h.policy_number ? `Policy ${h.policy_number}` : '',
        pt === 'insurance' && h.sum_assured ? `Cover Rs ${Number(h.sum_assured).toLocaleString('en-IN')}` : '',
      ]),
      held: pt === 'unlisted_share' || pt === 'secondary_bond' || pt === 'primary_bond' ? 'With Niyom · Demat'
        : pt === 'mutual_fund' ? 'With Niyom · Folio' : 'With Niyom',
      quantity: h.quantity || null,
      // DSA clients see the price they paid (client_price), not our avg_cost.
      price: (isDsa && h.client_price ? h.client_price : h.avg_cost) || null,
      invested: h.invested_amount || 0,
      value: h.current_value || 0,
    });
  }

  const registrar = input.registrar.filter((h) => registrarValueOf(h) > 0 || h.units > 0);
  const registrarValue = registrar.reduce((s, h) => s + registrarValueOf(h), 0);
  for (const h of registrar) {
    rows.push({
      category: 'mutual_fund',
      name: h.schemeName ?? h.schemeCode,
      detail: join([h.folio && `Folio ${h.folio}`]),
      held: 'With Niyom · Folio',
      quantity: h.units,
      price: h.nav,
      invested: h.investedCost,
      value: registrarValueOf(h),
    });
  }

  const { ours, outside, dematGroups } = countedStatementRows(input.cas, input.demat, registrarValue, {
    registrar,
    bookIsins: input.holdings.map((h) => h.isin),
  });
  const casRow = (r: CasCrmScheme, held: string): ReportRow => ({
    category: 'mutual_fund',
    name: r.name,
    detail: join([r.folioNumber && r.folioNumber !== 'unknown' && `Folio ${r.folioNumber}`]),
    held,
    quantity: r.units,
    price: r.nav || null,
    invested: r.cost > 0 ? r.cost : null,
    value: r.value,
  });
  for (const r of ours) rows.push(casRow(r, 'With Niyom · Folio'));
  for (const r of outside) rows.push(casRow(r, 'Outside Niyom · Folio'));

  for (const g of dematGroups) {
    for (const h of g.holdings) {
      rows.push({
        category: DEMAT_CATEGORY[g.key] ?? 'other',
        name: h.name,
        detail: join([h.isin && `ISIN ${h.isin}`]),
        held: 'Outside Niyom · Demat',
        quantity: h.units,
        price: h.price || null,
        invested: null,
        value: h.value,
      });
    }
  }

  return CATEGORIES.map((c) => {
    const own = rows.filter((r) => r.category === c.key).sort((a, b) => b.value - a.value);
    const costed = own.filter((r) => r.invested != null);
    return {
      ...c,
      rows: own,
      value: own.reduce((s, r) => s + r.value, 0),
      gain: costed.length ? costed.reduce((s, r) => s + r.value - (r.invested as number), 0) : null,
    };
  }).filter((c) => c.rows.length > 0);
}

/** The figures the report prints — the same sums as the on-screen cards. */
export function portfolioReportTotals(input: RowsInput): PortfolioReportTotals {
  const rows = buildReportCategories(input).flatMap((c) => c.rows);
  const value = rows.reduce((s, r) => s + r.value, 0);
  const invested = rows.reduce((s, r) => s + (r.invested ?? r.value), 0);
  return {
    value,
    invested,
    gainLoss: value - invested,
    rowCount: rows.length,
    unknownCostCount: rows.filter((r) => r.invested == null).length,
  };
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inr = (n: number): string => `&#8377;${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const units = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const signed = (n: number): string =>
  `<span class="${n >= 0 ? 'green' : 'red'}">${n >= 0 ? '+' : '-'}${inr(Math.abs(n))}</span>`;
const NA = '<span class="na">Not available</span>';

function categorySection(c: ReportCategory): string {
  const isFund = c.key === 'mutual_fund';
  const body = c.rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(r.name)}</strong>${r.detail ? `<br><span class="muted">${esc(r.detail)}</span>` : ''}</td>
      <td>${esc(r.held)}</td>
      <td>${r.quantity != null ? units(r.quantity) : '&mdash;'}</td>
      <td>${r.price ? inr(r.price) : '&mdash;'}</td>
      <td>${r.invested != null ? inr(r.invested) : NA}</td>
      <td>${inr(r.value)}</td>
      <td>${r.invested != null ? signed(r.value - r.invested) : NA}</td>
    </tr>`).join('');
  return `
    <div class="section-header" style="border-left:4px solid ${c.color}">
      <span class="section-title" style="color:${c.color}">${esc(c.label)}</span>
      <span class="section-summary">${c.rows.length} holding${c.rows.length === 1 ? '' : 's'} &nbsp;&middot;&nbsp; Value: ${inr(c.value)}${c.gain != null ? ` &nbsp;&middot;&nbsp; ${signed(c.gain)}` : ''}</span>
    </div>
    <table>
      <thead><tr><th>#</th><th>Holding</th><th>Held</th><th>${isFund ? 'Units' : 'Qty'}</th><th>${isFund ? 'NAV' : 'Price'}</th><th>Invested</th><th>Current Value</th><th>P&amp;L</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

export function buildPortfolioReportHtml(input: PortfolioReportInput): string {
  const totals = portfolioReportTotals(input);
  const sections = buildReportCategories(input).map(categorySection).join('');

  const stats = totals.rowCount === 0
    ? '<div class="empty">No holdings on record</div>'
    : `<div class="stats">
    <div class="stat" style="border-top-color:#d4af37"><div class="stat-label">Total Value</div><div class="stat-value gold">${inr(totals.value)}</div></div>
    <div class="stat" style="border-top-color:#6b7280"><div class="stat-label">Total Invested</div><div class="stat-value">${inr(totals.invested)}</div></div>
    <div class="stat" style="border-top-color:${totals.gainLoss >= 0 ? '#059669' : '#DC2626'}"><div class="stat-label">Gain / Loss</div><div class="stat-value">${signed(totals.gainLoss)}</div></div>
    <div class="stat" style="border-top-color:#0891B2"><div class="stat-label">Annual Interest</div><div class="stat-value" style="color:#0891B2">&#8377;${input.annualInterest.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
  </div>
  ${totals.unknownCostCount > 0 ? `<div class="stats-note">${totals.unknownCostCount} holding${totals.unknownCostCount === 1 ? '' : 's'} marked &ldquo;Not available&rdquo; ${totals.unknownCostCount === 1 ? 'has' : 'have'} no purchase cost on record (for example, units transferred in from another distributor). ${totals.unknownCostCount === 1 ? 'It is' : 'They are'} counted at current value in Total Invested, so Gain / Loss covers only the holdings with a known cost.</div>` : ''}`;

  const dateLong = input.now.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head>
  <title>Niyom Wealth - Portfolio Report</title>
  <style>
    @page { margin: 20mm 15mm; }
    body { font-family: Arial, sans-serif; background: #fff; color: #111; margin: 0; padding: 0; font-size: 13px; }
    .header { display: flex; align-items: center; gap: 14px; padding-bottom: 16px; border-bottom: 3px solid #d4af37; margin-bottom: 20px; }
    .logo-box { flex-shrink: 0; }
    .brand { font-size: 24px; font-weight: 900; color: #111; letter-spacing: -0.5px; }
    .sub { font-size: 11px; color: #888; margin-top: 2px; letter-spacing: 0.03em; }
    .client-bar { background: #f5f5f5; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 8px; }
    .stat { background: #f8f8f8; border-radius: 8px; padding: 12px 14px; border-top: 3px solid #eee; }
    .stat-label { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: 0.08em; }
    .stat-value { font-size: 17px; font-weight: 800; margin-top: 4px; }
    .stats-note { font-size: 10px; color: #888; margin-bottom: 16px; }
    .empty { background: #f8f8f8; border-radius: 8px; padding: 28px 14px; text-align: center; font-size: 14px; color: #666; }
    .section-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #fafafa; margin: 20px 0 0; border-left: 4px solid #ccc; }
    .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; }
    .section-summary { font-size: 11px; color: #666; }
    .section-note { font-size: 10px; color: #888; padding: 4px 12px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #f2f2f2; padding: 7px 10px; text-align: left; font-size: 10px; text-transform: uppercase; color: #777; letter-spacing: 0.04em; border-bottom: 1px solid #e0e0e0; }
    td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; font-size: 12px; vertical-align: top; }
    tr { page-break-inside: avoid; }
    tr:last-child td { border-bottom: none; }
    .gold { color: #b8961e; }
    .green { color: #059669; }
    .red { color: #DC2626; }
    .muted { color: #888; font-size: 11px; }
    .na { color: #999; font-style: italic; }
    .footer { margin-top: 32px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">${input.logoHtml}</div>
    <div>
      <div class="brand">Niyom Wealth</div>
      <div class="sub">Portfolio Report &nbsp;&middot;&nbsp; ${dateLong}</div>
    </div>
  </div>

  ${input.client ? `<div class="client-bar"><strong>${esc(input.client.full_name)}</strong> &nbsp;&middot;&nbsp; Code: ${esc(input.client.client_code)}</div>` : ''}

  ${stats}

  ${sections}

  <div class="footer">Niyom Wealth Distribution &nbsp;&middot;&nbsp; Confidential &nbsp;&middot;&nbsp; Generated ${input.now.toLocaleString('en-IN')}</div>
</body>
</html>`;
}
