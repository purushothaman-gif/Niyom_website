/**
 * Client portfolio statement (PDF) — every holding across bonds, mutual funds,
 * unlisted shares and anything else, in Niyom's branded document style.
 *
 * Built as an HTML document and rendered with html2pdf (the same pipeline as
 * the bond price list and receipts), dynamically imported so it never weighs
 * on the portal bundle. Pure inputs: nothing here touches the database.
 *
 * Honesty rules carried over from the on-screen board: an unknown cost is "—"
 * (never ₹0 / 0%), and the document states where each figure comes from and as
 * of when.
 */
import { NIYOM, NIYOM_BRAND } from '../../../crm/bonds/bondConstants';
import { ASSET_META, ASSET_ORDER, summarise, type AssetKey, type InvestmentRow } from '../../../../shared/portal/investments/model';
import type { RtaSipRow } from '../../../../shared/mf/rtaMf';

export type MfScope = 'niyom' | 'all';

export interface StatementInput {
  client: {
    full_name: string;
    client_code: string;
    pan?: string | null;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
  };
  rows: InvestmentRow[];
  sips: RtaSipRow[];
  mfScope: MfScope;
  /** When "all distributors" came from a CAS: the statement's end date. */
  casStatementTo?: string | null;
  /** Latest registrar / NAV valuation date, if known. */
  valuedOn?: string | null;
}

const ARN = 'ARN-362707';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const inr = (v: number | null | undefined, dp = 0) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

const num = (v: number | null | undefined, dp = 3) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: dp });

const pct = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%`;

const signed = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${inr(Math.abs(v))}`;

const fdate = (d: string | null | undefined) => {
  if (!d) return '—';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const maskPan = (p?: string | null) => (p && p.length >= 4 ? `XXXXXX${p.slice(-4)}` : '—');

const tone = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) || v === 0 ? '#5a6b85' : v > 0 ? '#15803d' : '#b91c1c';

interface Col {
  h: string;
  right?: boolean;
  cell: (r: InvestmentRow) => string;
  /** Footer (subtotal) cell. */
  foot?: (rows: InvestmentRow[]) => string;
}

const nameCell = (r: InvestmentRow, extra?: string) =>
  `<div style="font-weight:700;color:${NIYOM_BRAND.ink};">${esc(r.name)}</div>${
    extra ? `<div style="font-size:8px;color:#6b7a93;margin-top:1px;">${extra}</div>` : ''
  }`;

const sumInvested = (rows: InvestmentRow[]) => {
  const known = rows.filter((r) => r.invested != null);
  return known.length ? inr(known.reduce((s, r) => s + (r.invested ?? 0), 0)) : '—';
};
const sumValue = (rows: InvestmentRow[]) => inr(rows.reduce((s, r) => s + r.value, 0));
const sumReturns = (rows: InvestmentRow[]) => {
  const s = summarise(rows);
  return s.returnsPct == null
    ? '—'
    : `<span style="color:${tone(s.returns)}">${signed(s.returns)}<br/><span style="font-size:8px">${pct(s.returnsPct)}</span></span>`;
};

const returnsCell = (r: InvestmentRow) =>
  r.gain == null
    ? '<span style="color:#8a97ad">—</span>'
    : `<span style="color:${tone(r.gain)};font-weight:700">${signed(r.gain)}</span><br/><span style="font-size:8px;color:${tone(r.gain)}">${pct(r.gainPct)}</span>`;

const common = {
  invested: { h: 'Invested', right: true, cell: (r: InvestmentRow) => inr(r.invested), foot: sumInvested } as Col,
  value: {
    h: 'Current value',
    right: true,
    cell: (r: InvestmentRow) => `<b>${inr(r.value)}</b>`,
    foot: (rows: InvestmentRow[]) => `<b>${sumValue(rows)}</b>`,
  } as Col,
  returns: { h: 'Returns', right: true, cell: returnsCell, foot: sumReturns } as Col,
};

function columnsFor(asset: AssetKey, scope: MfScope): Col[] {
  switch (asset) {
    case 'mutual_fund':
      return [
        {
          h: 'Scheme',
          cell: (r) =>
            nameCell(
              r,
              [r.folio ? `Folio ${esc(r.folio)}` : '', r.category ? esc(r.category) : '', r.amc ? esc(r.amc) : '']
                .filter(Boolean)
                .join(' · '),
            ),
        },
        ...(scope === 'all'
          ? [
              {
                h: 'Distributor',
                cell: (r: InvestmentRow) =>
                  r.distributor === 'other' ? 'Other ARN' : r.distributor === 'unknown' ? 'Not stated' : 'Niyom',
              },
            ]
          : []),
        { h: 'Units', right: true, cell: (r) => num(r.units) },
        { h: 'NAV', right: true, cell: (r) => `${inr(r.price, 4)}${r.navDate ? `<br/><span style="font-size:8px;color:#8a97ad">${fdate(r.navDate)}</span>` : ''}` },
        common.invested,
        common.value,
        common.returns,
        { h: '1D change', right: true, cell: (r) => (r.dayChange == null ? '—' : `<span style="color:${tone(r.dayChange)}">${pct(r.dayChangePct)}</span>`) },
      ];
    case 'bond':
      return [
        { h: 'Bond', cell: (r) => nameCell(r, esc(r.isin ?? r.sub ?? '')) },
        { h: 'Coupon', right: true, cell: (r) => (r.coupon != null ? `${r.coupon}%` : '—') },
        { h: 'Interest', cell: (r) => esc(r.payoutFrequency ?? '—') },
        { h: 'Next payout', cell: (r) => fdate(r.nextPayout) },
        { h: 'Maturity', cell: (r) => fdate(r.maturity) },
        { h: 'Units', right: true, cell: (r) => num(r.units, 0) },
        common.invested,
        common.value,
        common.returns,
      ];
    case 'unlisted_share':
      return [
        { h: 'Company', cell: (r) => nameCell(r) },
        { h: 'Quantity', right: true, cell: (r) => num(r.units, 0) },
        { h: 'Avg. buy price', right: true, cell: (r) => inr(r.avgPrice, 2) },
        { h: 'Current price', right: true, cell: (r) => inr(r.price, 2) },
        common.invested,
        common.value,
        common.returns,
      ];
    default:
      return [
        { h: 'Holding', cell: (r) => nameCell(r, esc(r.issuer ?? '')) },
        { h: 'Maturity', cell: (r) => fdate(r.maturity) },
        common.invested,
        common.value,
        common.returns,
      ];
  }
}

function table(asset: AssetKey, rows: InvestmentRow[], scope: MfScope): string {
  const { navy, line, mist, gold } = NIYOM_BRAND;
  const cols = columnsFor(asset, scope);
  const meta = ASSET_META[asset];
  const head = cols
    .map((c) => `<th style="padding:6px 7px;font-size:8.5px;text-transform:uppercase;letter-spacing:.4px;color:#cfd8ea;text-align:${c.right ? 'right' : 'left'};font-weight:700;">${c.h}</th>`)
    .join('');
  const body = rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 ? mist : '#fff'};page-break-inside:avoid;">${cols
          .map((c) => `<td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};color:#1a2436;text-align:${c.right ? 'right' : 'left'};vertical-align:top;">${c.cell(r)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const foot = `<tr style="background:#fbf7ec;">${cols
    .map((c, i) =>
      i === 0
        ? `<td style="padding:7px;font-size:9px;font-weight:800;color:${navy};border-top:2px solid ${gold};">Total · ${rows.length} holding${rows.length === 1 ? '' : 's'}</td>`
        : `<td style="padding:7px;font-size:9px;font-weight:700;color:${navy};text-align:${c.right ? 'right' : 'left'};border-top:2px solid ${gold};">${c.foot ? c.foot(rows) : ''}</td>`,
    )
    .join('')}</tr>`;
  return `
  <div style="margin:16px 26px 0;page-break-inside:auto;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="display:inline-block;width:4px;height:16px;border-radius:2px;background:${meta.color};"></span>
      <span style="font-size:12px;font-weight:800;color:${navy};letter-spacing:.2px;">${meta.label}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid ${line};border-radius:6px;overflow:hidden;">
      <thead><tr style="background:${navy};">${head}</tr></thead>
      <tbody>${body}${foot}</tbody>
    </table>
  </div>`;
}

/** The statement as an HTML document (exported for previews and tests). */
export function buildStatementHtml(input: StatementInput): string {
  const { darkBlue, navy, gold, white, line } = NIYOM_BRAND;
  const { client, rows, sips, mfScope } = input;
  const s = summarise(rows);
  const today = fdate(new Date().toISOString());

  const tiles = [
    { k: 'Current value', v: inr(s.current) },
    { k: 'Invested', v: s.returnsPct == null ? '—' : inr(s.invested) },
    { k: 'Total returns', v: s.returnsPct == null ? '—' : `${signed(s.returns)} (${pct(s.returnsPct)})`, c: tone(s.returns) },
    { k: 'Holdings', v: `${s.count} · ${s.slices.length} asset class${s.slices.length === 1 ? '' : 'es'}` },
  ]
    .map(
      (t) => `<div style="flex:1;padding:11px 13px;border:1px solid ${line};border-radius:8px;background:#fff;">
        <div style="font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:#6b7a93;">${t.k}</div>
        <div style="margin-top:4px;font-size:15px;font-weight:800;color:${t.c ?? navy};">${t.v}</div></div>`,
    )
    .join('');

  const alloc = s.slices
    .map(
      (sl) => `<tr>
        <td style="padding:5px 8px;font-size:9.5px;color:#1a2436;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${sl.color};margin-right:6px;"></span>${sl.label}</td>
        <td style="padding:5px 8px;font-size:9px;color:#6b7a93;text-align:right;">${sl.count}</td>
        <td style="padding:5px 8px;width:45%;"><div style="height:7px;background:#eef2f9;border-radius:4px;overflow:hidden;"><div style="height:7px;width:${sl.percent.toFixed(1)}%;background:${sl.color};"></div></div></td>
        <td style="padding:5px 8px;font-size:9.5px;font-weight:700;color:${navy};text-align:right;">${sl.percent.toFixed(1)}%</td>
        <td style="padding:5px 8px;font-size:9.5px;font-weight:700;color:${navy};text-align:right;">${inr(sl.value)}</td>
      </tr>`,
    )
    .join('');

  const sections = ASSET_ORDER.map((a) => {
    const rs = rows.filter((r) => r.asset === a).sort((x, y) => y.value - x.value);
    return rs.length ? table(a, rs, mfScope) : '';
  }).join('');

  const activeSips = sips.filter((x) => x.status === 'active');
  const sipTable = activeSips.length
    ? `<div style="margin:16px 26px 0;">
        <div style="font-size:12px;font-weight:800;color:${navy};margin-bottom:6px;">Active systematic plans (SIP / STP / SWP)</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid ${line};">
          <thead><tr style="background:${navy};">${['Scheme', 'Type', 'Amount', 'Frequency', 'Day', 'Since', 'Until']
            .map((h, i) => `<th style="padding:6px 7px;font-size:8.5px;text-transform:uppercase;color:#cfd8ea;text-align:${i === 2 ? 'right' : 'left'};">${h}</th>`)
            .join('')}</tr></thead>
          <tbody>${activeSips
            .map(
              (x, i) => `<tr style="background:${i % 2 ? '#F4F6FB' : '#fff'};page-break-inside:avoid;">
              <td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};font-weight:600;">${esc(x.schemeName ?? x.schemeCode)}<div style="font-size:8px;color:#6b7a93;">Folio ${esc(x.folio)}</div></td>
              <td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};">${esc((x.type ?? 'SIP').toUpperCase())}</td>
              <td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};text-align:right;font-weight:700;">${inr(x.amount)}</td>
              <td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};">${esc(x.frequency ?? '—')}</td>
              <td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};">${esc(x.sipDay ?? '—')}</td>
              <td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};">${fdate(x.fromDate)}</td>
              <td style="padding:6px 7px;font-size:9px;border-bottom:1px solid ${line};">${fdate(x.toDate)}</td></tr>`,
            )
            .join('')}</tbody>
        </table></div>`
    : '';

  const scopeNote =
    mfScope === 'all'
      ? `Mutual funds include holdings with <b>all distributors</b>, read from your Consolidated Account Statement${
          input.casStatementTo ? ` dated up to ${fdate(input.casStatementTo)}` : ''
        }; those figures are as of that date.`
      : `Mutual funds show only holdings made <b>through Niyom (${ARN})</b>, as reported daily by the registrars (CAMS / KFintech)${
          input.valuedOn ? `, latest valuation ${fdate(input.valuedOn)}` : ''
        }.`;

  const unknownNote =
    s.unknownCostCount > 0
      ? `<li style="display:list-item;list-style:disc outside;">${s.unknownCostCount} registrar-reported fund${s.unknownCostCount > 1 ? 's do' : ' does'} not carry a purchase cost, so Invested and Returns show "—" for ${
          s.unknownCostCount > 1 ? 'them' : 'it'
        } and the totals cover the rest of the portfolio (${s.costCoveragePct.toFixed(0)}% by value).</li>`
      : '';

  const html = `
  <div style="width:1040px;font-family:Inter,Arial,Helvetica,sans-serif;color:#1a2436;background:#fff;">
    <div style="background:linear-gradient(135deg,${darkBlue},${navy});color:${white};padding:20px 26px;display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:14px;">
        <img src="/niyomlogo.png" crossorigin="anonymous" style="height:54px;width:auto;background:#fff;border-radius:8px;padding:4px;" />
        <div>
          <div style="font-size:16px;font-weight:800;letter-spacing:.4px;">${NIYOM.name}</div>
          <div style="font-size:9.5px;color:${gold};margin-top:2px;">AMFI-registered Mutual Fund Distributor · ${ARN}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:20px;font-weight:800;color:${gold};letter-spacing:.6px;">PORTFOLIO STATEMENT</div>
        <div style="font-size:9.5px;color:#cfd8ea;margin-top:3px;">Generated ${today}</div>
      </div>
    </div>

    <div style="margin:16px 26px 0;padding:12px 14px;border:1px solid ${line};border-radius:8px;display:flex;justify-content:space-between;background:#fbfbfd;">
      <div>
        <div style="font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:#6b7a93;">Investor</div>
        <div style="font-size:14px;font-weight:800;color:${navy};margin-top:2px;">${esc(client.full_name)}</div>
        <div style="font-size:9px;color:#5a6b85;margin-top:2px;">Client code ${esc(client.client_code)} · PAN ${maskPan(client.pan)}</div>
      </div>
      <div style="text-align:right;font-size:9px;color:#5a6b85;line-height:1.6;">
        ${client.email ? `${esc(client.email)}<br/>` : ''}${client.phone ? `${esc(client.phone)}<br/>` : ''}${esc([client.city, client.state].filter(Boolean).join(', '))}
      </div>
    </div>

    <div style="margin:12px 26px 0;display:flex;gap:10px;">${tiles}</div>

    <div style="margin:16px 26px 0;">
      <div style="font-size:12px;font-weight:800;color:${navy};margin-bottom:6px;">Asset allocation</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid ${line};border-radius:6px;">${alloc}</table>
    </div>

    ${sections}
    ${sipTable}

    <div style="margin:18px 26px 0;padding:11px 14px;border:1px solid ${line};border-radius:8px;background:#fbfbfd;page-break-inside:avoid;">
      <div style="font-size:10px;font-weight:800;color:${navy};margin-bottom:4px;">Notes</div>
      <ul style="margin:0;padding-left:16px;font-size:8.5px;color:#5a6b85;line-height:1.6;list-style:disc outside;">
        <li style="display:list-item;list-style:disc outside;">${scopeNote}</li>
        <li style="display:list-item;list-style:disc outside;">Mutual fund NAVs and 1-day changes are from AMFI's published NAVs. Bond and unlisted-share values are indicative, at Niyom's current price; final prices are confirmed on the deal confirmation.</li>
        ${unknownNote}
        <li style="display:list-item;list-style:disc outside;">Returns are absolute (current value less invested) and before tax. Past performance does not indicate future returns. Mutual fund investments are subject to market risks; read all scheme-related documents carefully.</li>
        <li style="display:list-item;list-style:disc outside;">This statement is generated from your Niyom Wealth account for information only and is not a contract note or tax document. For your registrar's official record, refer to your CAS from CAMS / KFintech.</li>
      </ul>
    </div>

    <div style="margin-top:16px;padding:10px 26px;border-top:2px solid ${gold};display:flex;justify-content:space-between;font-size:8.5px;color:#6b7a93;">
      <span>${NIYOM.name} · ${ARN}</span><span>${NIYOM.address}</span><span>${NIYOM.email} · ${NIYOM.web}</span>
    </div>
  </div>`;
  return html;
}

export async function generatePortfolioStatement(input: StatementInput): Promise<void> {
  const html = buildStatementHtml(input);
  const { client } = input;
  const { default: html2pdf } = await import('html2pdf.js');
  const c = document.createElement('div');
  c.style.position = 'fixed';
  c.style.left = '-10000px';
  c.style.top = '0';
  c.innerHTML = html;
  document.body.appendChild(c);
  try {
    await Promise.all(
      Array.from(c.querySelectorAll('img')).map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.onload = () => r();
              img.onerror = () => r();
            }),
      ),
    );
    const stamp = new Date().toISOString().slice(0, 10);
    // Built as a variable (as bondListPdf does): html2pdf's typings omit
    // `pagebreak`, which the library supports.
    const opt = {
        margin: [8, 0, 10, 0] as [number, number, number, number],
        filename: `Niyom_Portfolio_${client.client_code}_${stamp}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 1040 },
        jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'landscape' as const },
        pagebreak: { mode: ['css', 'legacy'] as string[], avoid: ['tr'] },
    };
    await html2pdf().set(opt).from(c.firstElementChild as HTMLElement).save();
  } finally {
    document.body.removeChild(c);
  }
}
