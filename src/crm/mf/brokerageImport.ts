// Parse the registrar/AMC "Brokerage Month-on-Month, Client-wise" Excel.
//
// Layout (header names, not fixed positions, so it survives column reorder):
//   a title row ("Time Period: 04/2026"), then a header row with
//   "Name" | one column per month ("Jul'26", "Aug'26", …) | "Total" | "GST" | "Trend %",
//   then one row per client with the per-month brokerage amounts.
//
// The month amounts are the ex-GST brokerage — the revenue. GST is a single
// per-client column (≈18% of the total); we keep a per-month GST figure for
// reference only (it is never counted as revenue). SheetJS is imported lazily.

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export interface BrokerageMonth {
  /** First of the month, ISO (e.g. "2026-07-01"). */
  periodMonth: string;
  /** The header text as written, e.g. "Jul'26". */
  label: string;
}

export interface BrokerageRow {
  rawName: string;
  periodMonth: string;
  label: string;
  brokerage: number; // ex-GST
  gst: number;       // reference only
}

export interface ParsedBrokerage {
  months: BrokerageMonth[];
  rows: BrokerageRow[];           // one per client+month with a non-zero amount
  clientNames: string[];          // distinct names, in file order
  totalBrokerage: number;
}

const norm = (v: unknown): string =>
  String(v ?? '').toLowerCase().replace(/[’']/g, "'").replace(/[_\-/.]+/g, ' ').replace(/\s+/g, ' ').trim();

const numeric = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** "Jul'26" / "Jul-26" / "July 2026" / "Jul 26" -> "2026-07-01", else null. */
export function parseMonthLabel(raw: unknown): string | null {
  const t = norm(raw);
  const m = t.match(/^([a-z]{3,4})[^0-9]*(\d{2,4})$/);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  if (!mon) return null;
  let yr = parseInt(m[2], 10);
  if (yr < 100) yr += 2000;
  return `${yr}-${String(mon).padStart(2, '0')}-01`;
}

/** Non-month columns we never treat as a period. */
const SKIP = new Set(['name', 'total', 'gst', 'trend %', 'trend', 'grand total']);

export async function parseBrokerageFile(buf: ArrayBuffer): Promise<ParsedBrokerage> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as unknown[][];

  // Header row = the first row with a "Name" cell AND at least one month column.
  let headerIdx = -1;
  let nameCol = -1;
  const monthCols: { col: number; month: BrokerageMonth }[] = [];
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const row = grid[i] || [];
    const nc = row.findIndex((c) => norm(c) === 'name');
    if (nc < 0) continue;
    const cands: { col: number; month: BrokerageMonth }[] = [];
    row.forEach((c, col) => {
      if (col === nc || SKIP.has(norm(c))) return;
      const pm = parseMonthLabel(c);
      if (pm) cands.push({ col, month: { periodMonth: pm, label: String(c).trim() } });
    });
    if (cands.length) { headerIdx = i; nameCol = nc; monthCols.push(...cands); break; }
  }
  if (headerIdx < 0) {
    throw new Error('Could not find the header row (a "Name" column and at least one month like "Jul\'26").');
  }

  const rows: BrokerageRow[] = [];
  const clientNames: string[] = [];
  let totalBrokerage = 0;
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const name = String(row[nameCol] ?? '').trim();
    if (!name || SKIP.has(norm(name))) continue; // skip blanks and a trailing total row
    clientNames.push(name);
    for (const { col, month } of monthCols) {
      const brokerage = Math.round(numeric(row[col]) * 100) / 100;
      if (brokerage === 0) continue;
      const gst = Math.round(brokerage * 0.18 * 100) / 100;
      rows.push({ rawName: name, periodMonth: month.periodMonth, label: month.label, brokerage, gst });
      totalBrokerage += brokerage;
    }
  }

  const months = monthCols
    .map((m) => m.month)
    .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  return { months, rows, clientNames, totalBrokerage: Math.round(totalBrokerage * 100) / 100 };
}

/** Normalised client name for matching the file to nw_clients.full_name. */
export function normName(v: unknown): string {
  return norm(v).replace(/\s+/g, ' ').trim();
}
