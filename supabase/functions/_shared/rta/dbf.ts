// Minimal dBASE (DBF) reader for the registrar mailback feeds (CAMS WBR*,
// KFintech). Those feeds are dBASE III/IV files: a header describing
// fixed-width ASCII fields, then one record per row. We read only what the
// importer needs — field names/types/widths and the raw cell text — and leave
// numeric/date interpretation to the caller's column map. No dependencies.

export interface DbfField {
  name: string;
  type: string; // 'C' | 'N' | 'D' | ...
  length: number;
  decimals: number;
}

export interface DbfTable {
  fields: DbfField[];
  /** One object per live (non-deleted) record: column name -> trimmed text. */
  rows: Record<string, string>[];
  deletedCount: number;
  /**
   * True when the file ended before the header's record count was reached — i.e.
   * the data was cut short (a corrupt/truncated feed). The rows read before the
   * cut are still returned, but the caller should treat the import as INCOMPLETE
   * rather than authoritative. (Seen with oversized CAMS WBR2 DBFs whose deflate
   * payload decompresses short of the header's usize.) Always set by parseDbf;
   * optional only so hand-built tables in tests need not specify it.
   */
  truncated?: boolean;
  /** Records the header declared — set by parseDbf alongside `truncated`. */
  declaredCount?: number;
}

const ascii = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

export function parseDbf(data: Uint8Array): DbfTable {
  if (data.length < 32) throw new Error('Not a DBF file (too short).');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const recordCount = view.getUint32(4, true);
  const headerLen = view.getUint16(8, true);
  const recordLen = view.getUint16(10, true);
  if (headerLen < 33 || recordLen < 1) throw new Error('Not a DBF file (bad header).');

  const fields: DbfField[] = [];
  let off = 32;
  while (off + 32 <= headerLen && data[off] !== 0x0d) {
    const name = ascii(data.subarray(off, off + 11)).replace(/\0.*$/, '').trim();
    const type = String.fromCharCode(data[off + 11]);
    const length = data[off + 16];
    const decimals = data[off + 17];
    if (name) fields.push({ name, type, length, decimals });
    off += 32;
  }
  if (!fields.length) throw new Error('DBF has no fields.');

  const rows: Record<string, string>[] = [];
  let deletedCount = 0;
  let truncated = false;
  let pos = headerLen;
  for (let r = 0; r < recordCount; r++) {
    if (pos + recordLen > data.length) {
      truncated = true; // the file ended before recordCount records were read
      break;
    }
    const flag = data[pos];
    if (flag === 0x2a) {
      // '*' = deleted record
      deletedCount++;
      pos += recordLen;
      continue;
    }
    let cur = pos + 1; // skip the 1-byte deletion flag
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = ascii(data.subarray(cur, cur + f.length)).replace(/\0/g, ' ').trim();
      cur += f.length;
    }
    rows.push(row);
    pos += recordLen;
  }
  return { fields, rows, deletedCount, truncated, declaredCount: recordCount };
}

/** dBASE 'N' cell -> number, or null when blank/non-numeric. */
export function dbfNumber(cell: string | undefined): number | null {
  if (cell == null) return null;
  const t = cell.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** dBASE 'D' cell (YYYYMMDD) -> ISO date string (YYYY-MM-DD), or null. */
export function dbfDate(cell: string | undefined): string | null {
  if (cell == null) return null;
  const t = cell.trim();
  if (!/^\d{8}$/.test(t)) return null;
  const y = t.slice(0, 4), m = t.slice(4, 6), d = t.slice(6, 8);
  if (m < '01' || m > '12' || d < '01' || d > '31' || y < '1900') return null;
  return `${y}-${m}-${d}`;
}
