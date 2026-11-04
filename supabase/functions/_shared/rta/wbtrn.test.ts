/**
 * KFintech WBTRN (Transaction Feeds, MFSD307) CSV mapping + direction
 * classification. The parser takes a CsvTable, so these build one directly (the
 * CSV byte reader is covered by csv parsing elsewhere). KFintech dates are
 * DD/MM/YYYY, amounts/units are positive magnitudes regardless of sign.
 */
import { describe, it, expect } from 'vitest';
import { parseWbtrn, isWbtrn } from './wbtrn.ts';
import type { CsvTable } from './csv.ts';

// A trimmed slice of the real 87-column WBTRN header — only the fields the
// parser reads, plus the required-set columns detection keys on.
const HEADER = [
  'Product Code', 'Fund', 'Folio Number', 'Scheme Code', 'Fund Description',
  'Transaction Head', 'Transaction Number', 'Investor Name', 'Transaction Date',
  'Process Date', 'Price', 'Units', 'Amount', 'Agent Code', 'Sub-Broker Code',
  'Report Date', 'Transaction Sub', 'Transaction Description', 'Transaction Type',
  'Nav', 'PAN1', 'EUIN', 'Dividend Option', 'Scheme',
];

const table = (rows: Record<string, string>[]): CsvTable => ({ header: HEADER, rows });

const base: Record<string, string> = {
  'Product Code': 'PP001RG', Fund: '128', 'Folio Number': '20625018', 'Scheme Code': 'PPFCF',
  'Fund Description': 'Parag Parikh Flexi Cap Fund - Regular Plan - Growth', 'Transaction Head': 'Purchase',
  'Transaction Number': '9000001', 'Investor Name': 'YAMUNADEVI P', 'Transaction Date': '15/07/2026',
  'Process Date': '16/07/2026', Price: '82.5400', Units: '1211.5200', Amount: '100000.00',
  'Agent Code': 'ARN-362707', 'Sub-Broker Code': '', 'Report Date': '04/11/2026',
  'Transaction Sub': '', 'Transaction Description': 'Purchase', 'Transaction Type': 'P',
  Nav: '82.5400', PAN1: 'AKCPY1234K', EUIN: 'E124361', 'Dividend Option': 'Z', Scheme: '',
};

describe('isWbtrn', () => {
  it('accepts a WBTRN layout and rejects others', () => {
    expect(isWbtrn(table([]))).toBe(true);
    expect(isWbtrn({ header: ['Folio', 'SipType', 'RegistrationDate', 'Amount'], rows: [] })).toBe(false);
    expect(isWbtrn({ header: ['Folio Number', 'Balance', 'AUM', 'NAV'], rows: [] })).toBe(false);
  });
});

describe('parseWbtrn', () => {
  it('maps a purchase row', () => {
    const { txns, snapshotDate } = parseWbtrn(table([{ ...base }]));
    expect(snapshotDate).toBe('2026-11-04');
    expect(txns).toHaveLength(1);
    const t = txns[0];
    expect(t.txn_kind).toBe('purchase');
    expect(t.trade_date).toBe('2026-07-15');
    expect(t.post_date).toBe('2026-07-16');
    expect(t.amount).toBe(100000);
    expect(t.units).toBe(1211.52);
    expect(t.nav).toBe(82.54);
    expect(t.pan).toBe('AKCPY1234K');
    expect(t.scheme_code).toBe('PP001RG'); // Product Code wins, matching the holdings feed
    expect(t.arn).toBe('ARN-362707');
    expect(t.txn_ref).toBe('20625018|PP001RG|9000001');
  });

  it('treats redemption as an outflow and stores a positive magnitude', () => {
    const [t] = parseWbtrn(table([{
      ...base, 'Transaction Head': 'Redemption', 'Transaction Description': 'Redemption',
      'Transaction Type': 'R', Amount: '-25000.00', Units: '-300.00', 'Transaction Number': '2',
    }])).txns;
    expect(t.txn_kind).toBe('redemption');
    expect(t.amount).toBe(25000);
    expect(t.units).toBe(300);
  });

  it('classifies switches and dividend reinvestment (no Y/N flag)', () => {
    const rows = [
      { ...base, 'Transaction Description': 'Switch Over - Out', 'Transaction Type': 'SO', 'Transaction Number': '3' },
      { ...base, 'Transaction Description': 'Switch Over - In', 'Transaction Type': 'SI', 'Transaction Number': '4' },
      { ...base, 'Transaction Description': 'Dividend Payout', 'Transaction Type': 'DP', 'Dividend Option': 'P', 'Transaction Number': '5' },
      { ...base, 'Transaction Description': 'Dividend Reinvestment', 'Transaction Type': 'DR', 'Dividend Option': 'R', 'Transaction Number': '6' },
    ];
    const kinds = parseWbtrn(table(rows)).txns.map((t) => t.txn_kind);
    expect(kinds).toEqual(['switch_out', 'switch_in', 'dividend', 'purchase']);
  });

  it('skips rows with no folio', () => {
    expect(parseWbtrn(table([{ ...base, 'Folio Number': '' }])).txns).toHaveLength(0);
  });
});
