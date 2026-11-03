// Minimal RFC-4180 CSV reader for the KFintech mailback feeds (which arrive as
// CSV inside the AES ZIP, where CAMS sends DBF). Handles quoted fields, escaped
// quotes (""), embedded commas and newlines, and CRLF or LF line endings. The
// first non-empty row is the header; each data row is returned as a
// column-name -> trimmed-value map, mirroring parseDbf's shape. No dependencies.

export interface CsvTable {
  header: string[];
  rows: Record<string, string>[];
}

/** Split CSV text into rows of raw string cells, honouring quotes. */
function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else if (ch === '\r') {
      // swallow; the \n (or EOF) ends the row
    } else {
      cell += ch;
    }
  }
  // flush the final cell/row if the file didn't end on a newline
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseCsv(data: Uint8Array): CsvTable {
  const text = new TextDecoder('utf-8').decode(data).replace(/^﻿/, '');
  const raw = tokenize(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (!raw.length) return { header: [], rows: [] };

  const header = raw[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = (cells[c] ?? '').trim();
    rows.push(row);
  }
  return { header, rows };
}
