/**
 * WBR77 (Consolidated Brokerage Payout Details) mapping, keys and the file
 * totals the pipeline reconciles against. Values mirror the live layout peeked
 * on 2026-11-07 (synthetic investor/folio values).
 */
import { describe, it, expect } from 'vitest';
import { classifyBrokerage, isWbr77, parseWbr77 } from './wbr77.ts';
import { detectReport } from './pipeline.ts';
import type { DbfTable } from './dbf.ts';

const NAMES = [
  'AMC_CODE', 'PROC_DATE', 'FOLIO_NO', 'SCHEME_COD', 'TRXN_TYPE', 'TRXN_NO', 'PLOT_AMOUN', 'PLOT_UNITS',
  'POST_DATE', 'TRADE_DATE', 'AUT_TXN_NO', 'AUTO_AMOUN', 'BROK_CODE', 'SUB_BRK_AR', 'ARN_EMP_CO', 'EUIN_VALID',
  'ADJ_FLAG', 'BRKAGE_TYP', 'BRKAGE_RAT', 'TOTAL_UPFR', 'BRKAGE_AMT', 'BRKAGE_FRO', 'BRKAGE_TO', 'PROC_FROM_',
  'PROC_TO_DA', 'TRXN_DESC', 'AVG_ASSETS', 'NO_OF_DAYS', 'ORIG_BRK_C', 'RATE_REF_I', 'TXN_SCH_CO', 'BRK_POSTED',
  'INV_NAME', 'IGST_VALUE', 'CGST_VALUE', 'SGST_VALUE', 'BROKERAGE_',
];
const FIELDS = NAMES.map((name) => ({ name, type: 'C', length: 10, decimals: 0 }));
const table = (rows: Record<string, string>[]): DbfTable => ({ fields: FIELDS, rows, deletedCount: 0 });

const trail = {
  AMC_CODE: 'L', PROC_DATE: '20260807', FOLIO_NO: '10203040', SCHEME_COD: '101G', TRXN_TYPE: 'SIMIP5L',
  TRXN_NO: '150206329', PLOT_AMOUN: '59997.000000', PLOT_UNITS: '900.844000', POST_DATE: '20260729',
  TRADE_DATE: '20260729', AUT_TXN_NO: '', AUTO_AMOUN: '', BROK_CODE: 'ARN-362707', SUB_BRK_AR: '',
  ARN_EMP_CO: 'E694551', EUIN_VALID: 'Y', ADJ_FLAG: 'N', BRKAGE_TYP: 'TF', BRKAGE_RAT: '0.459000',
  TOTAL_UPFR: '', BRKAGE_AMT: '2.263300', BRKAGE_FRO: '20260729', BRKAGE_TO: '20260731',
  PROC_FROM_: '20260701', PROC_TO_DA: '20260731', TRXN_DESC: 'Trailer Fee - Lumpsum',
  AVG_ASSETS: '59994.168500', NO_OF_DAYS: '3', ORIG_BRK_C: 'ARN-362707', RATE_REF_I: '065_A_2026-2027',
  TXN_SCH_CO: '017G', BRK_POSTED: '20260801', INV_NAME: 'ASHA RAO', IGST_VALUE: '0.407400',
  CGST_VALUE: '0.000000', SGST_VALUE: '0.000000', BROKERAGE_: '20260801',
};

describe('parseWbr77', () => {
  it('is detected as WBR77 (not WBR49, which shares FOLIO_NO/AUTO_AMOUN)', () => {
    expect(isWbr77(table([]))).toBe(true);
    expect(detectReport(table([]))).toBe('WBR77');
  });

  it('maps a trail line and dates it to the processing month', () => {
    const { lines, totals, snapshotDate } = parseWbr77(table([trail]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      registrar: 'CAMS', amc_code: 'L', scheme_code: '101G', folio: '10203040', euin: 'E694551',
      euin_valid: true, brokerage_type: 'TF', category: 'trail', brokerage: 2.2633, igst: 0.4074,
      rate: 0.459, avg_assets: 59994.1685, no_of_days: 3, brokerage_month: '2026-07-01',
      posted_date: '2026-08-01', arn: 'ARN-362707', trade_date: '2026-07-29',
    });
    expect(totals).toEqual({ rows: 1, brokerage: 2.2633, gst: 0.4074 });
    expect(snapshotDate).toBe('2026-08-07');
  });

  it('keys lines stably and numbers in-file duplicates so totals still add up', () => {
    const a = parseWbr77(table([trail, { ...trail }]));
    expect(a.lines.map((l) => l.row_key)).toEqual([a.lines[0].row_key, `${a.lines[0].row_key}#2`]);
    expect(a.totals.brokerage).toBeCloseTo(4.5266, 6);
    const b = parseWbr77(table([trail]));
    expect(b.lines[0].row_key).toBe(a.lines[0].row_key); // re-import → same key → upsert
  });

  it('refuses a record with no folio rather than silently dropping its amount', () => {
    expect(() => parseWbr77(table([{ ...trail, FOLIO_NO: '' }]))).toThrow(/no folio/);
  });
});

describe('classifyBrokerage', () => {
  it('splits trail / upfront / other', () => {
    expect(classifyBrokerage('TF', 'Trailer Fee - Lumpsum', 0)).toBe('trail');
    expect(classifyBrokerage('UF', null, 0)).toBe('upfront');
    expect(classifyBrokerage('XX', 'Upfront brokerage', 0)).toBe('upfront');
    expect(classifyBrokerage('', '', 125)).toBe('upfront');
    expect(classifyBrokerage('CL', 'Clawback', 0)).toBe('other');
  });
});
