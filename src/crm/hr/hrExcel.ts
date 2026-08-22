/**
 * Excel export for HR & Payroll.
 *
 * `xlsx` is imported dynamically everywhere. It is a heavy dependency and
 * vite.config.ts deliberately keeps it out of the initial bundle -- a static
 * import here would pull it into every CRM page load for a feature most people
 * use once a month.
 */

export type Cell = string | number | null | undefined;

export interface Sheet {
  name: string;
  /** First row is the header unless `noHeader`. */
  rows: Cell[][];
  noHeader?: boolean;
  /** Column widths in characters; falls back to a width derived from content. */
  widths?: number[];
}

function autoWidths(rows: Cell[][], given?: number[]): number[] {
  if (given) return given;
  const cols = Math.max(0, ...rows.map(r => r.length));
  return Array.from({ length: cols }, (_, c) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[c] ?? '').length), 0);
    return Math.min(42, Math.max(10, longest + 2));
  });
}

/** Write one or more sheets and hand the file to the browser. */
export async function exportWorkbook(fileName: string, sheets: Sheet[]): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][]);
    (ws as { '!cols'?: { wch: number }[] })['!cols'] = autoWidths(sheet.rows, sheet.widths).map(wch => ({ wch }));
    if (!sheet.noHeader && sheet.rows.length > 0) {
      // Freeze the header so a 300-row register stays readable while scrolling.
      (ws as { '!freeze'?: unknown })['!freeze'] = { xSplit: 0, ySplit: 1 };
    }
    // Excel refuses sheet names over 31 chars or containing : \ / ? * [ ]
    const safe = sheet.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Sheet1';
    XLSX.utils.book_append_sheet(wb, ws, safe);
  }

  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

/** A single-sheet export, which is what most screens want. */
export const exportSheet = (fileName: string, sheetName: string, rows: Cell[][]) =>
  exportWorkbook(fileName, [{ name: sheetName, rows }]);

/** Stamp used in generated file names: niyom_attendance_2026-08.xlsx */
export const periodStamp = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}`;
