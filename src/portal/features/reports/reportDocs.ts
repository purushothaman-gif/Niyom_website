/**
 * Report → document builders.
 *
 * Each function maps one report's domain rows into the generic `ReportPdfDoc`
 * the branded PDF engine renders. Pure and side-effect free (exported for
 * tests); the `download*` wrappers add the html2pdf step. Keeping the mapping
 * here means the engine never knows about holdings, disposals or lock-in lots —
 * it only lays out a titled, branded table.
 */
import type { NWClient } from '../../../crm/types';
import { fmtDate } from '../../../crm/utils';
import type { HoldingRow } from '../../../../shared/portal/types';
import type { TransactionRow } from '../../../../shared/portal/types/activity';
import type { ElssLockInLot } from '../../../../shared/portal/services/cas/elssLockIn';
import {
  displaySchemeName,
  termLabel,
  treatmentLabel,
  type Disposal,
} from '../../../../shared/portal/services/cas/gains';
import { generateReportPdf, type ReportPdfColumn, type ReportPdfDoc } from './reportPdf';

/** Rupees with exactly two decimals, the way a statement prints them. */
const inr = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const units = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 3 });

const today = () =>
  new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const safeCode = (c: NWClient | null) => (c?.client_code || 'client').replace(/[^\w-]/g, '');
const stamp = () => new Date().toISOString().slice(0, 10);

function clientOf(c: NWClient | null): ReportPdfDoc['client'] {
  return { full_name: c?.full_name || 'Investor', client_code: c?.client_code, pan: c?.pan };
}

const col = (header: string, right = false): ReportPdfColumn => ({ header, right });

/* ---------------------------------------------------------------- Capital gains */

export function capitalGainsDoc(
  disposals: Disposal[],
  fy: string,
  client: NWClient | null,
): ReportPdfDoc {
  const columns = [
    col('Scheme'), col('Bought'), col('Sold'), col('Units', true), col('Cost', true),
    col('Proceeds', true), col('Gain', true), col('Treatment'),
  ];
  const rows = disposals.map((d) => [
    displaySchemeName(d.schemeName),
    fmtDate(d.buyDate),
    fmtDate(d.sellDate),
    units(d.units),
    inr(d.cost),
    inr(d.proceeds),
    `${d.gain >= 0 ? '+' : '−'}${inr(Math.abs(d.gain))}`,
    `${termLabel(d.treatment)} · ${treatmentLabel(d.treatment)}`,
  ]);
  const gain = disposals.reduce((s, d) => s + d.gain, 0);
  const proceeds = disposals.reduce((s, d) => s + d.proceeds, 0);
  const cost = disposals.reduce((s, d) => s + d.cost, 0);
  return {
    title: 'Capital Gains Statement',
    subtitle: 'Mutual Funds',
    client: clientOf(client),
    meta: [
      { label: 'Financial Year', value: `FY ${fy}` },
      { label: 'Date', value: today() },
    ],
    summary: `Realised gain in FY ${fy} is ${gain >= 0 ? '' : '−'}${inr(Math.abs(gain))} across ${disposals.length} disposal${disposals.length === 1 ? '' : 's'}.`,
    columns,
    rows,
    totals: ['Total', '', '', '', inr(cost), inr(proceeds), `${gain >= 0 ? '+' : '−'}${inr(Math.abs(gain))}`, ''],
    notes: [
      'Gains are matched FIFO from your imported Consolidated Account Statement, as the Income-tax Act requires. Figures are indicative and exclude surcharge and cess.',
      'Gains taxed at your income-tax slab carry no rate here, because your slab is not known to us. Please check against your CAS before filing.',
    ],
    fileName: `Niyom_Capital_Gains_FY${fy}_${safeCode(client)}_${stamp()}.pdf`,
  };
}

/* ------------------------------------------------------------------- Holdings */

export function holdingsDoc(rows: HoldingRow[], client: NWClient | null): ReportPdfDoc {
  const columns = [
    col('Product'), col('Scheme / Security'), col('Asset Class'), col('Units', true),
    col('Invested', true), col('Value', true), col('P&L', true), col('P&L %', true),
  ];
  const body = rows.map((r) => [
    r.productLabel,
    r.name,
    r.assetClass,
    units(r.units),
    inr(r.invested),
    inr(r.value),
    `${r.gain >= 0 ? '+' : '−'}${inr(Math.abs(r.gain))}`,
    `${r.gainPercent >= 0 ? '+' : '−'}${Math.abs(r.gainPercent).toFixed(2)}%`,
  ]);
  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const value = rows.reduce((s, r) => s + r.value, 0);
  const gain = value - invested;
  return {
    title: 'Holdings Statement',
    client: clientOf(client),
    meta: [{ label: 'As on', value: today() }],
    summary: `Portfolio value ${inr(value)} across ${rows.length} holding${rows.length === 1 ? '' : 's'}.`,
    columns,
    rows: body,
    totals: ['Total', '', '', '', inr(invested), inr(value), `${gain >= 0 ? '+' : '−'}${inr(Math.abs(gain))}`, ''],
    notes: [
      'A snapshot of what you hold across mutual funds, bonds, shares and other products, valued at the latest available price. Not a contract note.',
    ],
    fileName: `Niyom_Holdings_${safeCode(client)}_${stamp()}.pdf`,
  };
}

/* --------------------------------------------------------------- Transactions */

export function transactionsDoc(rows: TransactionRow[], client: NWClient | null): ReportPdfDoc {
  const columns = [
    col('Date'), col('Product'), col('Scheme / Security'), col('Type'),
    col('Units', true), col('Price', true), col('Amount', true),
  ];
  const body = rows.map((r) => [
    fmtDate(r.date),
    r.productLabel,
    r.name,
    r.kindLabel ?? (r.txnType === 'buy' ? 'Buy' : 'Sell'),
    units(r.units),
    r.price == null ? '—' : inr(r.price),
    inr(r.amount),
  ]);
  const invested = rows.filter((r) => r.txnType === 'buy').reduce((s, r) => s + r.amount, 0);
  const redeemed = rows.filter((r) => r.txnType === 'sell').reduce((s, r) => s + r.amount, 0);
  return {
    title: 'Transaction Statement',
    client: clientOf(client),
    meta: [{ label: 'As on', value: today() }],
    summary: `${rows.length} transaction${rows.length === 1 ? '' : 's'} — invested ${inr(invested)}, redeemed ${inr(redeemed)}.`,
    columns,
    rows: body,
    notes: ['Every buy and sell across all products, from your Niyom Wealth account.'],
    fileName: `Niyom_Transactions_${safeCode(client)}_${stamp()}.pdf`,
  };
}

/* --------------------------------------------------------------------- Demat */

export function dematDoc(rows: HoldingRow[], client: NWClient | null): ReportPdfDoc {
  const columns = [
    col('Type'), col('Security'), col('ISIN'), col('Depository'), col('Units', true), col('Value', true),
  ];
  const body = rows.map((r) => [
    r.demat?.label ?? r.productLabel,
    r.name,
    r.demat?.isin ?? '—',
    (r.demat?.depository ?? '').toUpperCase() || '—',
    units(r.units),
    inr(r.value),
  ]);
  const value = rows.reduce((s, r) => s + r.value, 0);
  return {
    title: 'Demat Holdings',
    client: clientOf(client),
    meta: [{ label: 'As on', value: today() }],
    summary: `${rows.length} securit${rows.length === 1 ? 'y' : 'ies'} worth ${inr(value)}, as held in your demat account.`,
    columns,
    rows: body,
    totals: ['Total', '', '', '', '', inr(value)],
    notes: [
      'Shares, bonds and other securities from your imported demat statement (eCAS). A holdings snapshot, so no cost or gain is shown.',
    ],
    fileName: `Niyom_Demat_Holdings_${safeCode(client)}_${stamp()}.pdf`,
  };
}

/* ---------------------------------------------------------------------- ELSS */

/** Lot-level ELSS, modelled on a registrar's "Tax Investment Confirmation". */
export function elssLockInDoc(lots: ElssLockInLot[], client: NWClient | null): ReportPdfDoc {
  const showValue = lots.some((l) => l.currentValue !== null);
  const columns = [
    col('Mutual Fund'), col('ISIN'), col('Buy Date'), col('Units', true), col('Invested', true),
    ...(showValue ? [col('Current Value', true)] : []),
    col('Unlock Date'), col('Status'),
  ];
  const body = lots.map((l) => [
    l.schemeName,
    l.isin ?? '—',
    fmtDate(l.buyDate),
    units(l.units),
    inr(l.invested),
    ...(showValue ? [l.currentValue === null ? '—' : inr(l.currentValue)] : []),
    fmtDate(l.unlockDate),
    l.locked ? (l.daysToUnlock > 0 ? `Locked · ${l.daysToUnlock} days` : 'Locked') : 'Free',
  ]);
  const invested = lots.reduce((s, l) => s + l.invested, 0);
  const locked = lots.filter((l) => l.locked).reduce((s, l) => s + l.invested, 0);
  const value = lots.reduce((s, l) => s + (l.currentValue ?? 0), 0);
  const totals = [
    'Total', '', '', '', inr(invested),
    ...(showValue ? [inr(value)] : []),
    '', '',
  ];
  return {
    title: 'ELSS — Tax Investment Confirmation',
    subtitle: 'Section 80C',
    client: clientOf(client),
    meta: [{ label: 'Date', value: today() }],
    summary: `Total amount invested in ELSS is ${inr(invested)}${locked > 0 ? ` — ${inr(locked)} still within the three-year lock-in` : ''}.`,
    columns,
    rows: body,
    totals,
    notes: [
      'As per the Income-tax laws, these ELSS investments are eligible for a tax benefit under Section 80C.',
      'Each ELSS purchase is locked for three years from its own allotment date, so a monthly SIP unlocks a little each month. Worked out from the units still held in your imported statement or registrar feed.',
    ],
    fileName: `Niyom_ELSS_80C_${safeCode(client)}_${stamp()}.pdf`,
  };
}

/** ELSS from holdings alone, when no dated lots are available. */
export function elssHoldingsDoc(rows: HoldingRow[], client: NWClient | null): ReportPdfDoc {
  const columns = [
    col('Mutual Fund'), col('AMC'), col('Folio'), col('Units', true),
    col('Invested', true), col('Current Value', true),
  ];
  const body = rows.map((r) => [
    r.name,
    r.amc ?? '—',
    (r.meta ?? '').replace(/^Folio\s+/i, '') || '—',
    units(r.units),
    inr(r.invested),
    inr(r.value),
  ]);
  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const value = rows.reduce((s, r) => s + r.value, 0);
  return {
    title: 'ELSS — Tax Investment Confirmation',
    subtitle: 'Section 80C',
    client: clientOf(client),
    meta: [{ label: 'Date', value: today() }],
    summary: `Total amount invested in ELSS is ${inr(invested)}.`,
    columns,
    rows: body,
    totals: ['Total', '', '', '', inr(invested), inr(value)],
    notes: [
      'As per the Income-tax laws, these ELSS investments are eligible for a tax benefit under Section 80C.',
      'Matched from your holdings by scheme name; import your statement for lot-level lock-in dates.',
    ],
    fileName: `Niyom_ELSS_80C_${safeCode(client)}_${stamp()}.pdf`,
  };
}

/* ------------------------------------------------------- download convenience */

export const downloadCapitalGainsPdf = (d: Disposal[], fy: string, c: NWClient | null) =>
  generateReportPdf(capitalGainsDoc(d, fy, c));
export const downloadHoldingsPdf = (r: HoldingRow[], c: NWClient | null) =>
  generateReportPdf(holdingsDoc(r, c));
export const downloadTransactionsPdf = (r: TransactionRow[], c: NWClient | null) =>
  generateReportPdf(transactionsDoc(r, c));
export const downloadDematPdf = (r: HoldingRow[], c: NWClient | null) =>
  generateReportPdf(dematDoc(r, c));
export const downloadElssLockInPdf = (l: ElssLockInLot[], c: NWClient | null) =>
  generateReportPdf(elssLockInDoc(l, c));
export const downloadElssHoldingsPdf = (r: HoldingRow[], c: NWClient | null) =>
  generateReportPdf(elssHoldingsDoc(r, c));
