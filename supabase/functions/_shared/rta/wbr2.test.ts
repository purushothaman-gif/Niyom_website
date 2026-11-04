/**
 * CAMS WBR2 transaction mapping + direction classification. The parser takes a
 * DbfTable, so these build one directly (the DBF byte reader is covered by
 * dbf.test.ts). Dates are dBASE 'D' cells: YYYYMMDD.
 */
import { describe, it, expect } from 'vitest';
import { parseWbr2, isWbr2 } from './wbr2.ts';
import { classifyTxn } from './txns.ts';
import type { DbfTable } from './dbf.ts';

const FIELDS = [
  'AMC_CODE', 'FOLIO_NO', 'PRODCODE', 'SCHEME', 'INV_NAME', 'TRXNTYPE', 'TRXNNO',
  'TRADDATE', 'POSTDATE', 'PURPRICE', 'UNITS', 'AMOUNT', 'BROKCODE', 'SUBBROK',
  'REP_DATE', 'TRXNSUBTYP', 'REINVEST_F', 'PAN', 'TRXN_TYPE_', 'EUIN', 'SCHEME_FOL',
].map((name) => ({ name, type: 'C', length: 10, decimals: 0 }));

const table = (rows: Record<string, string>[]): DbfTable => ({ fields: FIELDS, rows, deletedCount: 0 });

const base: Record<string, string> = {
  AMC_CODE: 'H', FOLIO_NO: '34268297 / 74', PRODCODE: 'H02', SCHEME: 'HDFC Flexi Cap Fund - Growth',
  INV_NAME: 'HEMANTH A E', TRXNTYPE: 'P', TRXNNO: '1000001', TRADDATE: '20260715',
  POSTDATE: '20260716', PURPRICE: '1850.50', UNITS: '60.8320', AMOUNT: '120000.00',
  BROKCODE: 'ARN-362707', SUBBROK: '', REP_DATE: '20261103', TRXNSUBTYP: '',
  REINVEST_F: 'N', PAN: 'AKCPH1164J', TRXN_TYPE_: 'Purchase', EUIN: 'E124361', SCHEME_FOL: '',
};

describe('isWbr2', () => {
  it('accepts a WBR2 layout and rejects others', () => {
    expect(isWbr2(table([]))).toBe(true);
    expect(isWbr2({ fields: [{ name: 'FOLIOCHK', type: 'C', length: 10, decimals: 0 }], rows: [], deletedCount: 0 })).toBe(false);
  });
});

describe('parseWbr2', () => {
  it('maps a purchase row', () => {
    const { txns, snapshotDate } = parseWbr2(table([{ ...base }]));
    expect(snapshotDate).toBe('2026-11-03');
    expect(txns).toHaveLength(1);
    const t = txns[0];
    expect(t.txn_kind).toBe('purchase');
    expect(t.trade_date).toBe('2026-07-15');
    expect(t.amount).toBe(120000);
    expect(t.units).toBe(60.832);
    expect(t.nav).toBe(1850.5);
    expect(t.pan).toBe('AKCPH1164J');
    expect(t.scheme_code).toBe('H02');
    expect(t.txn_ref).toBe('34268297 / 74|H02|1000001');
  });

  it('treats redemption as an outflow and stores a positive magnitude', () => {
    const [t] = parseWbr2(table([{ ...base, TRXN_TYPE_: 'Redemption', TRXNTYPE: 'R', AMOUNT: '-5000.00', TRXNNO: '2' }])).txns;
    expect(t.txn_kind).toBe('redemption');
    expect(t.amount).toBe(5000);
  });

  it('classifies switches and dividends', () => {
    const rows = [
      { ...base, TRXN_TYPE_: 'Switch Over - Out', TRXNNO: '3' },
      { ...base, TRXN_TYPE_: 'Switch Over - In', TRXNNO: '4' },
      { ...base, TRXN_TYPE_: 'Dividend Payout', TRXNNO: '5' },
      { ...base, TRXN_TYPE_: 'Dividend Reinvestment', REINVEST_F: 'Y', TRXNNO: '6' },
    ];
    const kinds = parseWbr2(table(rows)).txns.map((t) => t.txn_kind);
    expect(kinds).toEqual(['switch_out', 'switch_in', 'dividend', 'purchase']);
  });
});

describe('classifyTxn', () => {
  it('falls back to the short code when the description is blank', () => {
    expect(classifyTxn(null, 'SO', null, null)).toBe('switch_out');
    expect(classifyTxn(null, 'R', null, null)).toBe('redemption');
    expect(classifyTxn(null, 'P', null, null)).toBe('purchase');
    expect(classifyTxn(null, 'ZZ', null, null)).toBe('other');
  });
});
