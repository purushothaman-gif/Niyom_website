import { describe, expect, it } from 'vitest';
import type { NWClient } from '../../../crm/types';
import type { HoldingRow } from '../../../../shared/portal/types';
import type { TransactionRow } from '../../../../shared/portal/types/activity';
import type { ElssLockInLot } from '../../../../shared/portal/services/cas/elssLockIn';
import type { Disposal } from '../../../../shared/portal/services/cas/gains';
import {
  capitalGainsDoc,
  dematDoc,
  elssHoldingsDoc,
  elssLockInDoc,
  holdingsDoc,
  transactionsDoc,
} from './reportDocs';
import { buildReportHtml, type ReportPdfDoc } from './reportPdf';

const client = { full_name: 'Test Investor', client_code: 'NW0010001', pan: 'ABCDE1234F' } as NWClient;

/** Every row and the totals row must have exactly as many cells as columns. */
function expectAligned(doc: ReportPdfDoc) {
  const n = doc.columns.length;
  for (const r of doc.rows) expect(r).toHaveLength(n);
  if (doc.totals) expect(doc.totals).toHaveLength(n);
  // The engine must render without throwing and carry the brand + investor.
  const html = buildReportHtml(doc);
  expect(html).toContain(doc.title);
  expect(html).toContain('NIYOM WEALTH');
  expect(html).toContain('XXXXXX234F'); // PAN is masked to the last four.
}

const holding = (over: Partial<HoldingRow>): HoldingRow => ({
  id: 'h', productType: 'mutual_fund', productLabel: 'Mutual Fund', productColor: '#000',
  name: 'Some Fund', assetClass: 'Equity', invested: 1000, value: 1200, gain: 200, gainPercent: 20,
  ...over,
});

describe('report doc builders keep rows aligned to columns', () => {
  it('holdings', () => expectAligned(holdingsDoc([holding({}), holding({ name: 'B' })], client)));

  it('transactions', () => {
    const rows: TransactionRow[] = [
      { id: 't1', productType: 'mutual_fund', productLabel: 'MF', productColor: '#000', name: 'F', txnType: 'buy', amount: 5000, units: 10, price: 500, date: '2026-04-02' },
    ];
    expectAligned(transactionsDoc(rows, client));
  });

  it('demat', () => {
    const rows = [holding({
      productType: 'listed_equity' as HoldingRow['productType'], name: 'TCS',
      demat: { source: 'demat', importId: 'i', importedAt: '', statementDate: null, isin: 'INE467B01029', depository: 'cdsl', assetClass: 'Equity', label: 'Stocks', color: '#000' },
    })];
    expectAligned(dematDoc(rows, client));
  });

  it('capital gains', () => {
    const d: Disposal[] = [{
      schemeId: 's', schemeName: 'Fund - Growth', isin: 'INF1', fy: '2026-27',
      buyDate: '2020-01-01', sellDate: '2026-05-01', units: 10, buyNav: 10, sellNav: 20,
      actualCost: 100, cost: 100, grandfathered: false, proceeds: 200, gain: 100, holdingDays: 2000,
      treatment: { kind: 'equity', term: 'long', rate: 0.125 },
    }];
    expectAligned(capitalGainsDoc(d, '2026-27', client));
  });

  const lot = (over: Partial<ElssLockInLot>): ElssLockInLot => ({
    schemeName: 'ELSS Fund', isin: 'INF9', buyDate: '2025-06-01', units: 50, invested: 8000,
    currentValue: 8400, unlockDate: '2028-06-01', locked: true, daysToUnlock: 566, ...over,
  });

  it('elss lock-in with current value', () =>
    expectAligned(elssLockInDoc([lot({}), lot({ locked: false, daysToUnlock: 0 })], client)));

  it('elss lock-in without current value (no NAV known)', () =>
    expectAligned(elssLockInDoc([lot({ currentValue: null })], client)));

  it('elss holdings fallback', () =>
    expectAligned(elssHoldingsDoc([holding({ name: 'ELSS Fund', meta: 'Folio 123', amc: 'Kotak' })], client)));
});

describe('summary line', () => {
  it('states the ELSS total like the registrar confirmation', () => {
    const doc = elssLockInDoc(
      [{ schemeName: 'K', isin: null, buyDate: '2026-04-02', units: 1, invested: 1999.9, currentValue: null, unlockDate: '2029-04-02', locked: true, daysToUnlock: 800 }],
      client,
    );
    expect(doc.summary).toContain('Total amount invested in ELSS is ₹1,999.90');
  });
});
