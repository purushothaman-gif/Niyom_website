/** WBR39 scheme master → scheme labels used by the brokerage MIS. */
import { describe, it, expect } from 'vitest';
import { isWbr39, parseWbr39 } from './wbr39.ts';
import { detectReport } from './pipeline.ts';
import type { DbfTable } from './dbf.ts';

const NAMES = ['AMC_CODE', 'AMC', 'SCH_CODE', 'SCH_NAME', 'SCH_TYPE', 'PLAN_TYPE', 'ASSET_CLAS', 'SEBI_CLASS',
  'ISIN_NO', 'PARENT_SCH', 'SIP_ALLOW'];
const FIELDS = NAMES.map((name) => ({ name, type: 'C', length: 10, decimals: 0 }));
const table = (rows: Record<string, string>[]): DbfTable => ({ fields: FIELDS, rows, deletedCount: 0 });
const row = {
  AMC_CODE: 'K', AMC: 'Kotak Mahindra Mutual Fund', SCH_CODE: '1197', SCH_NAME: 'Kotak Multi Asset Allocation Fund - Regular Growth',
  SCH_TYPE: 'Balanced', PLAN_TYPE: 'REGULAR', ASSET_CLAS: 'EQUITY', SEBI_CLASS: 'Balanced', ISIN_NO: 'INF174KA1XX1',
  PARENT_SCH: '1197', SIP_ALLOW: 'Y',
};

describe('parseWbr39', () => {
  it('is detected as the scheme master', () => {
    expect(isWbr39(table([]))).toBe(true);
    expect(detectReport(table([]))).toBe('WBR39');
  });

  it('keeps the labelling columns and de-duplicates by AMC + scheme code', () => {
    const { schemes, rows } = parseWbr39(table([row, { ...row, SCH_NAME: 'Renamed' }, { ...row, SCH_CODE: '' }]));
    expect(rows).toBe(3);
    expect(schemes).toHaveLength(1);
    expect(schemes[0]).toMatchObject({
      registrar: 'CAMS', amc_code: 'K', scheme_code: '1197', amc_name: 'Kotak Mahindra Mutual Fund',
      scheme_name: 'Renamed', plan_type: 'REGULAR', asset_class: 'EQUITY', isin: 'INF174KA1XX1',
    });
  });
});
