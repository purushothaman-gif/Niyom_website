/**
 * Report exporters
 * -----------------------------------------------------------------------------
 * Client-side .xlsx generation from data already in memory (no server, no BSE).
 * Uses the app's existing `xlsx` dependency via dynamic import so it never
 * weighs on the initial bundle. Amounts are written as raw numbers so the sheet
 * stays analysable in Excel.
 */
import type { NWClient } from '../../crm/types';
import { fmtDate } from '../../crm/utils';
import type { HoldingRow } from '../types';
import type { TransactionRow } from '../types/activity';
import { saveFile, XLSX_MIME } from '../../platform/fileWriter';

const stamp = () => new Date().toISOString().slice(0, 10);
const safeCode = (c: NWClient | null) => (c?.client_code || 'client').replace(/[^\w-]/g, '');

async function writeSheet(aoa: (string | number)[][], sheetName: string, fileName: string) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  /*
   * `XLSX.writeFile` triggers a BROWSER download and does nothing in an app, so
   * the bytes are produced here and delivery is left to the platform — a
   * download on the website, a share sheet on a phone. See platform/fileWriter.
   */
  const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
  await saveFile({ fileName, base64, mimeType: XLSX_MIME });
}

export async function exportTransactionsXlsx(rows: TransactionRow[], client: NWClient | null) {
  const header = ['Date', 'Product', 'Scheme / Security', 'Type', 'Units', 'Price', 'Amount (INR)'];
  const body = rows.map((r) => [
    fmtDate(r.date),
    r.productLabel,
    r.name,
    r.txnType === 'buy' ? 'Buy' : 'Sell',
    r.units ?? '',
    r.price ?? '',
    r.amount,
  ]);
  await writeSheet(
    [header, ...body],
    'Transactions',
    `niyom_transactions_${safeCode(client)}_${stamp()}.xlsx`,
  );
}

export async function exportHoldingsXlsx(rows: HoldingRow[], client: NWClient | null) {
  const header = [
    'Product', 'Scheme / Security', 'Asset Class', 'Units', 'Invested (INR)',
    'Current Value (INR)', 'P&L (INR)', 'P&L %',
  ];
  const body = rows.map((r) => [
    r.productLabel,
    r.name,
    r.assetClass,
    r.units ?? '',
    r.invested,
    r.value,
    r.gain,
    Number(r.gainPercent.toFixed(2)),
  ]);
  await writeSheet(
    [header, ...body],
    'Holdings',
    `niyom_holdings_${safeCode(client)}_${stamp()}.xlsx`,
  );
}

/**
 * The capital gains statement, one row per matched lot.
 *
 * Deliberately one row per DISPOSAL rather than per redemption: a single
 * redemption of 800 units can consume a dozen SIP instalments bought at a dozen
 * prices, each with its own holding period and possibly its own grandfathered
 * cost. Collapsing them would hide exactly the working a client (or their CA)
 * needs to check the figure.
 *
 * Both costs are written. `Cost` is what the gain is computed on; `Actual Cost`
 * is what was really paid. They differ only where grandfathering applies, and
 * seeing the two side by side is what makes the relief legible rather than
 * looking like an arithmetic error.
 */
export async function exportCapitalGainsXlsx(
  rows: {
    schemeName: string;
    isin: string | null;
    buyDate: string;
    sellDate: string;
    units: number;
    buyNav: number;
    sellNav: number;
    actualCost: number;
    cost: number;
    grandfathered: boolean;
    proceeds: number;
    gain: number;
    term: string;
    treatment: string;
  }[],
  fy: string,
  client: NWClient | null,
) {
  const header = [
    'Scheme', 'ISIN', 'Purchase Date', 'Sale Date', 'Units', 'Purchase NAV', 'Sale NAV',
    'Actual Cost (INR)', 'Cost (INR)', 'Grandfathered', 'Proceeds (INR)', 'Gain (INR)',
    'Term', 'Tax Treatment',
  ];
  const body = rows.map((r) => [
    r.schemeName,
    r.isin ?? '',
    fmtDate(r.buyDate),
    fmtDate(r.sellDate),
    Number(r.units.toFixed(3)),
    Number(r.buyNav.toFixed(4)),
    Number(r.sellNav.toFixed(4)),
    Number(r.actualCost.toFixed(2)),
    Number(r.cost.toFixed(2)),
    r.grandfathered ? 'Yes' : '',
    Number(r.proceeds.toFixed(2)),
    Number(r.gain.toFixed(2)),
    r.term,
    r.treatment,
  ]);
  await writeSheet(
    [header, ...body],
    `Capital Gains ${fy}`,
    `niyom_capital_gains_${fy}_${safeCode(client)}_${stamp()}.xlsx`,
  );
}
