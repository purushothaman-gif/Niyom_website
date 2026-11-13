/**
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
 *   invested = book cost + statement cost, with anything that has no cost
 *              entered at value so it adds nothing to gain/loss
 *
 * A registrar or demat holding without a cost prints "Not available" for cost
 * and gain — never ₹0 invested or a 0% gain nobody can support.
 *
 * Pure: data in, HTML string out. The page does the loading and the printing.
 */
import type { RtaHoldingRow } from '../../shared/mf/rtaMf';
import type { NWClient, NWHolding, ProductType } from './types';
import { fmtDate, PRODUCT_LABELS } from './utils';
import type { CasCrmScheme, CasCrmView } from './services/casClientView';
import type { DematCrmView } from './services/dematClientView';
import { countedStatementRows } from './services/statementTotals';

const BOND_TYPES: ProductType[] = ['secondary_bond', 'primary_bond', 'fixed_deposit'];
const DSA_PRICE_TYPES: ProductType[] = ['unlisted_share', 'secondary_bond', 'primary_bond'];
const PAYOUT_FREQ: Record<string, string> = { annual: 'Annual', halfyearly: 'Half-Yearly', quarterly: 'Quarterly', monthly: 'Monthly' };
const SECTION_COLORS: Record<string, string> = {
  unlisted_share: '#7C3AED', secondary_bond: '#0891B2', primary_bond: '#0E7490',
  mutual_fund: '#DB2777', fixed_deposit: '#D97706', insurance: '#EA580C',
};
const MF_COLOR = '#DB2777';
const OUTSIDE_COLOR = '#9A6FD0';
const DEMAT_COLOR = '#2E9E8F';

export interface PortfolioReportInput {
  /** The client the report is for, or null for a whole-book print. */
  client: Pick<NWClient, 'full_name' | 'client_code'> | null;
  /** Product types to print from the book, in order. */
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
  /** Rows printed across every section. */
  rowCount: number;
  /** True when some value has no cost behind it (entered at value). */
  hasUnknownCost: boolean;
}

export const registrarValueOf = (h: RtaHoldingRow): number => h.rtaValue ?? h.navValue ?? 0;

/** The figures the report prints — the same sums as the on-screen cards. */
export function portfolioReportTotals(
  input: Pick<PortfolioReportInput, 'holdings' | 'registrar' | 'cas' | 'demat'>,
): PortfolioReportTotals {
  const registrar = input.registrar.filter((h) => registrarValueOf(h) > 0 || h.units > 0);
  const registrarValue = registrar.reduce((s, h) => s + registrarValueOf(h), 0);
  const { ours, outside, dematGroups } = countedStatementRows(input.cas, input.demat, registrarValue);
  const casRows = [...ours, ...outside];
  const dematValue = dematGroups.reduce((s, g) => s + g.value, 0);
  const dematCount = dematGroups.reduce((s, g) => s + g.holdings.length, 0);

  const bookValue = input.holdings.reduce((s, h) => s + (h.current_value || 0), 0);
  const bookInvested = input.holdings.reduce((s, h) => s + (h.invested_amount || 0), 0);
  const value = bookValue + registrarValue + casRows.reduce((s, r) => s + r.value, 0) + dematValue;
  const invested = bookInvested + registrarValue + casRows.reduce((s, r) => s + r.cost, 0) + dematValue;
  return {
    value,
    invested,
    gainLoss: value - invested,
    rowCount: input.holdings.length + registrar.length + casRows.length + dematCount,
    hasUnknownCost: registrarValue > 0 || dematValue > 0,
  };
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inr = (n: number): string => `&#8377;${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const units = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const signed = (n: number): string =>
  `<span class="${n >= 0 ? 'green' : 'red'}">${n >= 0 ? '+' : '-'}${inr(Math.abs(n))}</span>`;
const NA = '<span class="na">Not available</span>';

function sectionHeader(title: string, color: string, count: number, value: number, gain: number | null, note?: string): string {
  return `
    <div class="section-header" style="border-left:4px solid ${color}">
      <span class="section-title" style="color:${color}">${esc(title)}</span>
      <span class="section-summary">${count} holding${count === 1 ? '' : 's'} &nbsp;&middot;&nbsp; Value: ${inr(value)}${gain != null ? ` &nbsp;&middot;&nbsp; ${signed(gain)}` : ''}</span>
    </div>${note ? `<div class="section-note">${esc(note)}</div>` : ''}`;
}

function bookSections(input: PortfolioReportInput): string {
  return input.products.map((pt) => {
    const group = input.holdings.filter((h) => h.product_type === pt);
    if (group.length === 0) return '';
    const groupValue = group.reduce((s, h) => s + (h.current_value || 0), 0);
    const groupInvested = group.reduce((s, h) => s + (h.invested_amount || 0), 0);
    const isBondType = BOND_TYPES.includes(pt);

    const extraCols = isBondType ? '<th>Coupon</th><th>Maturity</th>'
      : pt === 'mutual_fund' ? '<th>Folio No.</th><th>NAV</th>'
      : pt === 'insurance' ? '<th>Policy No.</th><th>Cover</th>'
      : '';

    const rows = group.map((h, i) => {
      const isDsaHolding = input.clientOf(h.client_id)?.sourced_via === 'dsa' && DSA_PRICE_TYPES.includes(pt);
      // DSA clients see the price they paid (client_price), not our avg_cost.
      const displayPrice = isDsaHolding && h.client_price ? h.client_price : (h.avg_cost || 0);
      const pl = (h.current_value || 0) - (h.invested_amount || 0);
      const joined = (h as NWHolding & { client?: { full_name?: string } }).client;
      const extraTds = isBondType
        ? `<td>${h.coupon_rate ? esc(h.coupon_rate) + '% ' + (PAYOUT_FREQ[h.payout_frequency || 'annual'] || '') : '&mdash;'}</td><td>${h.maturity_date ? fmtDate(h.maturity_date) : '&mdash;'}</td>`
        : pt === 'mutual_fund'
        ? `<td>${h.folio_number ? esc(h.folio_number) : '&mdash;'}</td><td>${h.current_nav ? inr(Number(h.current_nav)) : '&mdash;'}</td>`
        : pt === 'insurance'
        ? `<td>${h.policy_number ? esc(h.policy_number) : '&mdash;'}</td><td>${h.sum_assured ? inr(Number(h.sum_assured)) : '&mdash;'}</td>`
        : '';
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${esc(h.product_name)}</strong>${!input.client && joined?.full_name ? `<br><span class="muted">${esc(joined.full_name)}</span>` : ''}</td>
        <td>${h.quantity || '&mdash;'}</td>
        <td>${inr(displayPrice)}</td>
        <td>${inr(h.invested_amount || 0)}</td>
        <td>${inr(h.current_value || 0)}</td>
        <td>${signed(pl)}</td>
        ${extraTds}
      </tr>`;
    }).join('');

    return `${sectionHeader(PRODUCT_LABELS[pt], SECTION_COLORS[pt] || '#555', group.length, groupValue, groupValue - groupInvested)}
      <table>
        <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Price / Unit</th><th>Invested</th><th>Current Value</th><th>P&amp;L</th>${extraCols}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');
}

const MF_HEAD = '<thead><tr><th>#</th><th>Scheme</th><th>Folio No.</th><th>Units</th><th>NAV</th><th>Invested</th><th>Current Value</th><th>P&amp;L</th></tr></thead>';

function registrarSection(rows: RtaHoldingRow[]): string {
  if (rows.length === 0) return '';
  const value = rows.reduce((s, h) => s + registrarValueOf(h), 0);
  const body = rows.map((h, i) => {
    const v = registrarValueOf(h);
    const cost = h.investedCost;
    return `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(h.schemeName ?? h.schemeCode)}</strong></td>
      <td>${esc(h.folio) || '&mdash;'}</td>
      <td>${units(h.units)}</td>
      <td>${h.nav ? inr(h.nav) : '&mdash;'}</td>
      <td>${cost != null ? inr(cost) : NA}</td>
      <td>${inr(v)}</td>
      <td>${cost != null ? signed(v - cost) : NA}</td>
    </tr>`;
  }).join('');
  return `${sectionHeader('Mutual Funds', MF_COLOR, rows.length, value, null, 'As reported by the registrar (CAMS / KFintech), valued at the latest NAV.')}
    <table>${MF_HEAD}<tbody>${body}</tbody></table>`;
}

function casSection(title: string, color: string, rows: CasCrmScheme[], note: string): string {
  if (rows.length === 0) return '';
  const value = rows.reduce((s, r) => s + r.value, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const body = rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(r.name)}</strong>${r.amc ? `<br><span class="muted">${esc(r.amc)}</span>` : ''}</td>
      <td>${esc(r.folioNumber) || '&mdash;'}</td>
      <td>${units(r.units)}</td>
      <td>${r.nav ? inr(r.nav) : '&mdash;'}</td>
      <td>${r.cost > 0 ? inr(r.cost) : NA}</td>
      <td>${inr(r.value)}</td>
      <td>${r.cost > 0 ? signed(r.value - r.cost) : NA}</td>
    </tr>`).join('');
  return `${sectionHeader(title, color, rows.length, value, cost > 0 ? value - cost : null, note)}
    <table>${MF_HEAD}<tbody>${body}</tbody></table>`;
}

function dematSections(groups: ReturnType<typeof countedStatementRows>['dematGroups'], statementDate: string | null): string {
  return groups.map((g) => {
    const body = g.holdings.map((h, i) => `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(h.name)}</strong>${h.dpName ? `<br><span class="muted">${esc(h.dpName)}</span>` : ''}</td>
      <td>${h.isin ? esc(h.isin) : '&mdash;'}</td>
      <td>${units(h.units)}</td>
      <td>${h.price ? inr(h.price) : '&mdash;'}</td>
      <td>${NA}</td>
      <td>${inr(h.value)}</td>
    </tr>`).join('');
    const title = /demat/i.test(g.label) ? g.label : `${g.label} (demat)`;
    return `${sectionHeader(title, DEMAT_COLOR, g.holdings.length, g.value, null, `From the client's demat statement${statementDate ? ` dated ${fmtDate(statementDate)}` : ''}. Held outside Niyom.`)}
      <table>
        <thead><tr><th>#</th><th>Security</th><th>ISIN</th><th>Qty</th><th>Price</th><th>Invested</th><th>Current Value</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }).join('');
}

export function buildPortfolioReportHtml(input: PortfolioReportInput): string {
  const registrar = input.registrar.filter((h) => registrarValueOf(h) > 0 || h.units > 0);
  const registrarValue = registrar.reduce((s, h) => s + registrarValueOf(h), 0);
  const { ours, outside, dematGroups } = countedStatementRows(input.cas, input.demat, registrarValue);
  const totals = portfolioReportTotals(input);
  const casDate = input.cas?.statementTo ? ` to ${fmtDate(input.cas.statementTo)}` : '';

  const sections = [
    bookSections(input),
    registrarSection(registrar),
    casSection('Mutual Funds (statement)', MF_COLOR, ours, `From the client's consolidated account statement${casDate}.`),
    casSection('Mutual Funds held outside Niyom', OUTSIDE_COLOR, outside, `From the client's consolidated account statement${casDate}. Held through another distributor.`),
    dematSections(dematGroups, input.demat?.statementDate ?? null),
  ].join('');

  const stats = totals.rowCount === 0
    ? '<div class="empty">No holdings on record</div>'
    : `<div class="stats">
    <div class="stat" style="border-top-color:#d4af37"><div class="stat-label">Total Value</div><div class="stat-value gold">${inr(totals.value)}</div></div>
    <div class="stat" style="border-top-color:#6b7280"><div class="stat-label">Total Invested</div><div class="stat-value">${inr(totals.invested)}</div></div>
    <div class="stat" style="border-top-color:${totals.gainLoss >= 0 ? '#059669' : '#DC2626'}"><div class="stat-label">Gain / Loss</div><div class="stat-value">${signed(totals.gainLoss)}</div></div>
    <div class="stat" style="border-top-color:#0891B2"><div class="stat-label">Annual Interest</div><div class="stat-value" style="color:#0891B2">&#8377;${input.annualInterest.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
  </div>
  ${totals.hasUnknownCost ? '<div class="stats-note">Holdings whose purchase cost is not available are counted at their current value in Total Invested, so they add nothing to Gain / Loss.</div>' : ''}`;

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
