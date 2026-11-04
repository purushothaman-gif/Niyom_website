/**
 * The registrar feeds are dBASE files we never get to see decrypted outside the
 * server, so the parser is pinned against a DBF built here byte-for-byte to the
 * same III/IV layout CAMS uses: a 32-byte header, 32-byte field descriptors
 * terminated by 0x0D, then fixed-width ASCII records with a 1-byte delete flag.
 * A deleted record and a blank numeric are included because both occur in real
 * feeds and both have bitten naive readers before.
 */
import { describe, it, expect } from 'vitest';
import { parseDbf, dbfNumber, dbfDate } from './dbf.ts';
import { parseWbr9, isWbr9 } from './wbr9.ts';

interface FieldSpec {
  name: string;
  type: string;
  length: number;
  decimals?: number;
}

/** Assemble a dBASE III file from field specs and already-formatted cells. */
function buildDbf(fields: FieldSpec[], records: { deleted?: boolean; cells: string[] }[]): Uint8Array {
  const recLen = 1 + fields.reduce((n, f) => n + f.length, 0);
  const headerLen = 32 + fields.length * 32 + 1;
  const buf = new Uint8Array(headerLen + records.length * recLen + 1);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x03;
  dv.setUint32(4, records.length, true);
  dv.setUint16(8, headerLen, true);
  dv.setUint16(10, recLen, true);

  let off = 32;
  for (const f of fields) {
    for (let i = 0; i < f.name.length && i < 11; i++) buf[off + i] = f.name.charCodeAt(i);
    buf[off + 11] = f.type.charCodeAt(0);
    buf[off + 16] = f.length;
    buf[off + 17] = f.decimals ?? 0;
    off += 32;
  }
  buf[off] = 0x0d; // header terminator
  off += 1;

  for (const rec of records) {
    buf[off] = rec.deleted ? 0x2a : 0x20;
    let cur = off + 1;
    rec.cells.forEach((cell, i) => {
      const width = fields[i].length;
      const padded = cell.length >= width ? cell.slice(0, width) : cell.padEnd(width, ' ');
      for (let j = 0; j < width; j++) buf[cur + j] = padded.charCodeAt(j);
      cur += width;
    });
    off += recLen;
  }
  buf[off] = 0x1a; // EOF marker
  return buf;
}

const WBR9_FIELDS: FieldSpec[] = [
  { name: 'FOLIOCHK', type: 'C', length: 10 },
  { name: 'SCH_NAME', type: 'C', length: 14 },
  { name: 'PRODUCT', type: 'C', length: 4 },
  { name: 'AMC_CODE', type: 'C', length: 3 },
  { name: 'INV_NAME', type: 'C', length: 12 },
  { name: 'PAN_NO', type: 'C', length: 10 },
  { name: 'CLOS_BAL', type: 'N', length: 12, decimals: 3 },
  { name: 'RUPEE_BAL', type: 'N', length: 14, decimals: 2 },
  { name: 'REP_DATE', type: 'D', length: 8 },
  { name: 'FOLIO_DATE', type: 'D', length: 8 },
];

function cell(folio: string, sch: string, prod: string, amc: string, name: string, pan: string, units: string, value: string, rep: string, open: string) {
  return [folio, sch, prod, amc, name, pan, units, value, rep, open];
}

describe('parseDbf', () => {
  it('reads fields, skips deleted records, trims cells', () => {
    const dbf = buildDbf(WBR9_FIELDS, [
      { cells: cell('12345/67', 'HDFC Top 100', 'H101', '053', 'RAMYA K', 'ABCPR1234A', '    1000.500', '     125000.00', '20261102', '20240110') },
      { deleted: true, cells: cell('00000/00', 'DELETED', 'X', '000', 'GONE', 'ZZZPZ9999Z', '0', '0', '20261102', '20240110') },
      { cells: cell('999/0', 'ICICI Bluechip', 'I202', '020', 'RAMYA K', 'ABCPR1234A', '', '', '20261102', '20250601') },
    ]);
    const t = parseDbf(dbf);
    expect(t.fields.map((f) => f.name)).toContain('CLOS_BAL');
    expect(t.deletedCount).toBe(1);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].FOLIOCHK).toBe('12345/67');
    expect(t.rows[0].SCH_NAME).toBe('HDFC Top 100');
    expect(t.rows[0].CLOS_BAL).toBe('1000.500');
    expect(t.truncated).toBe(false);
    expect(t.declaredCount).toBe(3);
  });

  it('flags a file cut short of its declared record count as truncated', () => {
    const full = buildDbf(WBR9_FIELDS, [
      { cells: cell('1/1', 'A', 'A1', '001', 'X', 'ABCPR1234A', '1.000', '10.00', '20261102', '20240110') },
      { cells: cell('2/2', 'B', 'B1', '002', 'Y', 'ABCPR1234A', '2.000', '20.00', '20261102', '20240110') },
      { cells: cell('3/3', 'C', 'C1', '003', 'Z', 'ABCPR1234A', '3.000', '30.00', '20261102', '20240110') },
    ]);
    // Header still claims 3 records, but the bytes stop partway through record 2.
    const recLen = 1 + WBR9_FIELDS.reduce((n, f) => n + f.length, 0);
    const headerLen = 32 + WBR9_FIELDS.length * 32 + 1;
    const cut = full.subarray(0, headerLen + recLen + Math.floor(recLen / 2));
    const t = parseDbf(cut);
    expect(t.declaredCount).toBe(3);
    expect(t.rows).toHaveLength(1); // only the first complete record survived
    expect(t.truncated).toBe(true);
  });
});

describe('dbfNumber / dbfDate', () => {
  it('parses numbers and blanks', () => {
    expect(dbfNumber('  1000.500')).toBe(1000.5);
    expect(dbfNumber('')).toBeNull();
    expect(dbfNumber('   ')).toBeNull();
    expect(dbfNumber('abc')).toBeNull();
  });
  it('parses YYYYMMDD dates and rejects junk', () => {
    expect(dbfDate('20261102')).toBe('2026-11-02');
    expect(dbfDate('00000000')).toBeNull();
    expect(dbfDate('        ')).toBeNull();
    expect(dbfDate('2026-11-02')).toBeNull();
  });
});

describe('parseWbr9', () => {
  const dbf = buildDbf(WBR9_FIELDS, [
    { cells: cell('12345/67', 'HDFC Top 100', 'H101', '053', 'RAMYA K', 'ABCPR1234A', '    1000.500', '     125000.00', '20261102', '20240110') },
    { cells: cell('12345/67', 'HDFC Flexi', 'H102', '053', 'RAMYA K', 'ABCPR1234A', '     500.000', '      60000.00', '20261102', '20240110') },
    { cells: cell('999/0', 'ICICI Bluechip', 'I202', '020', 'SURESH R', 'notapan', '', '', '20261102', '20250601') },
  ]);

  it('recognises the feed by its columns', () => {
    expect(isWbr9(parseDbf(dbf))).toBe(true);
  });

  it('collapses one folio-master per folio and one holding per scheme row', () => {
    const r = parseWbr9(parseDbf(dbf), 'CAMS');
    expect(r.snapshotDate).toBe('2026-11-02');
    expect(r.folios.size).toBe(2); // 12345/67 and 999/0
    expect(r.holdings).toHaveLength(3); // two schemes on the first folio + one

    const f = r.folios.get('12345/67')!;
    expect(f.holder_name).toBe('RAMYA K');
    expect(f.pan).toBe('ABCPR1234A');
    expect(f.amc_code).toBe('053');
    expect(f.folio_open_date).toBe('2024-01-10');

    const h = r.holdings.find((x) => x.scheme_code === 'H101')!;
    expect(h.units).toBe(1000.5);
    expect(h.rta_value).toBe(125000);
    expect(h.snapshot_date).toBe('2026-11-02');
  });

  it('keeps only a validly-formatted PAN', () => {
    const r = parseWbr9(parseDbf(dbf), 'CAMS');
    expect(r.folios.get('999/0')!.pan).toBeNull(); // 'notapan' rejected
  });

  it('rejects a file that is not WBR9', () => {
    const other = buildDbf([{ name: 'FOO', type: 'C', length: 3 }], [{ cells: ['abc'] }]);
    expect(() => parseWbr9(parseDbf(other))).toThrow(/WBR9/);
  });
});
