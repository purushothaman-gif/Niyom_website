import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {}, clientSupabase: {} }));

import type { RtaHoldingRow } from '../../shared/mf/rtaMf';
import type { NWHolding } from './types';
import type { CasCrmView } from './services/casClientView';
import type { DematCrmView } from './services/dematClientView';
import { statementTotals } from './services/statementTotals';
import { buildPortfolioReportHtml, portfolioReportTotals, type PortfolioReportInput } from './portfolioReport';

const rta = (o: Partial<RtaHoldingRow>): RtaHoldingRow => ({
  id: 'r1', folio: '123/45', schemeName: 'Alpha Flexi Cap Fund', schemeCode: 'AF1', amcCode: null,
  units: 10, rtaValue: 3000, registrarValue: 2900, nav: 300, navValue: 3000, navDate: null, isin: null,
  snapshotDate: null, investedCost: null, firstInvestmentDate: null, reconciled: false, flows: [], ...o,
});
const cas = (schemes: object[]) => ({ statementTo: '2026-10-31', schemes } as unknown as CasCrmView);
const scheme = (o: object) => ({ id: 's', name: 'Beta Bluechip Fund', folioNumber: 'F9', amc: 'Beta MF', units: 5, nav: 100, value: 500, cost: 400, ownership: 'held_away', ...o });
const demat = (groups: object[]) => ({ statementDate: '2026-10-31', groups } as unknown as DematCrmView);
const stock = { id: 'd', name: 'Gamma Industries Ltd', isin: 'INE000A01010', units: 4, value: 2000, price: 500, dpName: null };

const input = (o: Partial<PortfolioReportInput>): PortfolioReportInput => ({
  client: { full_name: 'Test Client', client_code: 'NW-000-0000' },
  products: ['unlisted_share', 'secondary_bond'],
  holdings: [], clientOf: () => undefined, annualInterest: 0,
  registrar: [], cas: null, demat: null, logoHtml: '', now: new Date('2026-11-13T09:00:00Z'), ...o,
});

describe('portfolio report', () => {
  it('says so plainly when the client holds nothing anywhere', () => {
    const html = buildPortfolioReportHtml(input({}));
    expect(html).toContain('No holdings on record');
    expect(html).not.toContain('Total Value');
  });

  it('prints holdings that live only outside the in-house book', () => {
    const i = input({
      registrar: [rta({})],
      cas: cas([scheme({}), scheme({ id: 'o', name: 'Our Own Fund', ownership: 'held_with_niyom', value: 900, cost: 800 })]),
      demat: demat([
        { key: 'equity', label: 'Stocks', value: 2000, holdings: [stock] },
        { key: 'demat_mf', label: 'Mutual Funds (demat)', value: 700, holdings: [{ ...stock, name: 'Demat MF' }] },
      ]),
    });
    const html = buildPortfolioReportHtml(i);
    expect(html).toContain('Alpha Flexi Cap Fund');
    expect(html).toContain('Beta Bluechip Fund');
    expect(html).toContain('Gamma Industries Ltd');
    // Already in the registrar feed / already in the CAS: listed once, not twice.
    expect(html).not.toContain('Our Own Fund');
    expect(html).not.toContain('Demat MF');
    expect(html).not.toContain('No holdings on record');

    const t = portfolioReportTotals(i);
    expect(t.value).toBe(3000 + 500 + 2000);
    expect(t.invested).toBe(3000 + 400 + 2000);
    expect(t.gainLoss).toBe(100);
    expect(t.rowCount).toBe(3);
  });

  it('matches the on-screen summary cards', () => {
    const book = [{ id: 'h', client_id: 'c', product_type: 'unlisted_share', product_name: 'Delta Pvt Ltd', quantity: 10, avg_cost: 90, invested_amount: 900, current_value: 1200 }] as unknown as NWHolding[];
    const c = cas([scheme({})]);
    const d = demat([{ key: 'equity', label: 'Stocks', value: 2000, holdings: [stock] }]);
    const t = portfolioReportTotals({ holdings: book, registrar: [rta({})], cas: c, demat: d });
    const screen = statementTotals(c, d, 3000);
    expect(t.value).toBe(1200 + 3000 + screen.value);
    expect(t.invested).toBe(900 + 3000 + screen.invested);
  });

  it('shows an unknown cost as not available, never as a zero gain', () => {
    const html = buildPortfolioReportHtml(input({ registrar: [rta({})] }));
    const row = html.slice(html.indexOf('Alpha Flexi Cap Fund'));
    expect(row.slice(0, row.indexOf('</tr>')).match(/Not available/g)).toHaveLength(2);
    expect(html).toContain('counted at their current value');

    const known = buildPortfolioReportHtml(input({ registrar: [rta({ investedCost: 2500 })] }));
    const kRow = known.slice(known.indexOf('Alpha Flexi Cap Fund'));
    expect(kRow.slice(0, kRow.indexOf('</tr>'))).not.toContain('Not available');
  });

  it('escapes names and never names the fund platform', () => {
    const html = buildPortfolioReportHtml(input({ registrar: [rta({ schemeName: 'A <b>& B</b> Fund' })] }));
    expect(html).toContain('A &lt;b&gt;&amp; B&lt;/b&gt; Fund');
    expect(html.toLowerCase()).not.toContain('wylth');
  });
});
