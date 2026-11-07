/** CAMS WBR53 / WBR22 full-book snapshots + KFintech Investor Master (WBMST). */
import { describe, it, expect } from 'vitest';
import { isWbr22, isWbr53, parseWbr22, parseWbr53 } from './wbr53.ts';
import { isKfAum, isKfMaster, parseKfMaster } from './kfintech.ts';
import { detectReport } from './pipeline.ts';
import type { DbfTable } from './dbf.ts';
import type { CsvTable } from './csv.ts';

const dbf = (names: string[], rows: Record<string, string>[]): DbfTable => ({
  fields: names.map((name) => ({ name, type: 'C', length: 20, decimals: 0 })), rows, deletedCount: 0,
});

// Real column order captured from the live files on 2026-11-07.
const WBR53 = ['FOLIOCHK', 'PRODUCT', 'BAL_DATE', 'CLOS_BAL', 'RUPEE_BAL', 'BROK_DLR_C', 'LAST_TRXN_', 'EUIN', 'PAN',
  'AMC_CODE', 'FOLIO_OLD', 'SCHEME_FOL'];
const WBR22 = ['BROK_DLR_C', 'PRODUCT', 'ASSET_DATE', 'FOLIO', 'INV_NAME', 'SCHEME_NAM', 'CLOSING_AS', 'CITY', 'AE_CODE',
  'TAX_STATUS', 'UNITS', 'NAV', 'INV_IIN', 'FOLIO_OLD', 'SCHEME_FOL'];
const WBR9_MIN = ['FOLIOCHK', 'CLOS_BAL', 'SCH_NAME', 'PRODUCT', 'RUPEE_BAL'];

describe('WBR53 valuation snapshot', () => {
  const t = dbf(WBR53, [
    { FOLIOCHK: '123/45', PRODUCT: 'PP001RG', BAL_DATE: '20261105', CLOS_BAL: '36.771', RUPEE_BAL: '3003.60',
      BROK_DLR_C: 'ARN-362707', PAN: 'abcde1234f', AMC_CODE: 'PP' },
    { FOLIOCHK: '123/45', PRODUCT: 'PP002RG', BAL_DATE: '20261105', CLOS_BAL: '10', RUPEE_BAL: '500',
      PAN: 'ABCDE1234F', AMC_CODE: 'PP' },
    { FOLIOCHK: '', PRODUCT: 'X', BAL_DATE: '20261105', CLOS_BAL: '1', RUPEE_BAL: '1' },
  ]);
  it('is detected, and WBR9 is not mistaken for it', () => {
    expect(isWbr53(t)).toBe(true);
    expect(detectReport(t)).toBe('WBR53');
    expect(detectReport(dbf(WBR9_MIN, []))).toBe('WBR9');
  });
  it('yields one folio, one holding per scheme, PAN normalised, product code as scheme code', () => {
    const p = parseWbr53(t);
    expect(p.snapshotDate).toBe('2026-11-05');
    expect(p.folios.size).toBe(1);
    expect(p.folios.get('123/45')).toMatchObject({ pan: 'ABCDE1234F', amc_code: 'PP', arn: 'ARN-362707', email: null });
    expect(p.holdings).toHaveLength(2);
    expect(p.holdings[0]).toMatchObject({ scheme_code: 'PP001RG', units: 36.771, rta_value: 3003.6, scheme_name: null });
  });
});

describe('WBR22 AuM snapshot', () => {
  const t = dbf(WBR22, [
    { PRODUCT: 'K1197', ASSET_DATE: '30-Oct-2026', FOLIO: '9988776', INV_NAME: 'A INVESTOR', SCHEME_NAM: 'Kotak Multi Asset',
      CLOSING_AS: '15000.5', TAX_STATUS: 'Individual', UNITS: '1000', NAV: '15.0005', BROK_DLR_C: 'ARN-362707' },
  ]);
  it('is detected and parsed with its text as-of date', () => {
    expect(isWbr22(t)).toBe(true);
    expect(detectReport(t)).toBe('WBR22');
    const p = parseWbr22(t);
    expect(p.snapshotDate).toBe('2026-10-30');
    expect(p.holdings[0]).toMatchObject({ folio: '9988776', scheme_code: 'K1197', units: 1000, nav: 15.0005, rta_value: 15000.5 });
    expect(p.folios.get('9988776')).toMatchObject({ holder_name: 'A INVESTOR', tax_status: 'Individual', pan: null });
  });
});

describe('KFintech Investor Master (WBMST)', () => {
  const header = ['Product Code', 'Fund', 'Folio', 'Fund Description', 'Investor Name', 'Joint Name 1', 'Joint Name 2',
    'Tax Status', 'Email', 'BankAccno', 'Broker Code', 'Report Date', 'PAN Number', 'Mobile Number', 'PAN2', 'PAN3',
    'DPID', 'Date of Birth', 'Holder 1 Aadhaar info'];
  const row = (folio: string, product: string): Record<string, string> => ({
    'Product Code': product, Fund: '117', Folio: folio, 'Investor Name': 'B INVESTOR', 'Joint Name 1': 'C JOINT',
    'Tax Status': 'Individual', Email: 'b@example.com', BankAccno: '000111222333', 'Broker Code': 'ARN-362707',
    'Report Date': '06/11/2026', 'PAN Number': 'PQRSX9876Z', 'Mobile Number': '9000000000', PAN2: 'LMNOP1234Q',
    'Date of Birth': '01/01/1980', 'Holder 1 Aadhaar info': 'XXXX1234',
  });
  const csv: CsvTable = { header, rows: [row('1001', '117A'), row('1001', '117B'), row('1002', '117A')] };
  it('is detected as the master, not the AUM report', () => {
    expect(isKfMaster(csv)).toBe(true);
    expect(isKfAum(csv)).toBe(false);
  });
  it('gives one folio row per folio, no holdings, and never keeps bank / DOB / Aadhaar', () => {
    const p = parseKfMaster(csv);
    expect(p.holdings).toHaveLength(0);
    expect(p.folios.size).toBe(2);
    expect(p.snapshotDate).toBe('2026-11-06');
    const f = p.folios.get('1001')!;
    expect(f).toMatchObject({ pan: 'PQRSX9876Z', joint_names: ['C JOINT'], joint_pans: ['LMNOP1234Q'], arn: 'ARN-362707' });
    const stored = JSON.stringify(f);
    expect(stored).not.toContain('000111222333');
    expect(stored).not.toContain('1980');
    expect(stored).not.toContain('XXXX1234');
  });
});
