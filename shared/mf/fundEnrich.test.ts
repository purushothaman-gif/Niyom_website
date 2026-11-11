import { describe, expect, it } from 'vitest';
import { enrichMutualFunds, ownIsin } from './fundEnrich';
import type { NiyomDb } from '../platform/db';
import type { InvestmentRow } from '../portal/investments/model';

/**
 * A stand-in for the Supabase query builder: every chained call returns the
 * builder, awaiting it yields the table's canned rows, and `.in('isin', …)`
 * filters them so a lookup only sees the ISINs it asked for.
 */
function fakeDb(tables: Record<string, Record<string, unknown>[]>): NiyomDb {
  const builder = (rows: Record<string, unknown>[]) => {
    let data = rows;
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'gte', 'lte', 'or']) b[m] = () => b;
    b.in = (col: string, vals: string[]) => {
      data = data.filter((r) => vals.includes(String(r[col])));
      return b;
    };
    b.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(res, rej);
    return b;
  };
  return { from: (t: string) => builder(tables[t] ?? []) } as unknown as NiyomDb;
}

const fund = (p: Partial<InvestmentRow>): InvestmentRow => ({
  id: 'r1',
  asset: 'mutual_fund',
  productType: 'mutual_fund',
  name: 'x',
  units: 272.765,
  avgPrice: null,
  price: 70.199,
  invested: 18081,
  value: 19148,
  gain: 1067,
  gainPct: 5.9,
  dayChange: null,
  dayChangePct: null,
  source: 'statement',
  ...p,
});

describe('ownIsin', () => {
  it('accepts an AMFI ISIN, upper-cased', () => expect(ownIsin(' inf178l01095 ')).toBe('INF178L01095'));
  it('rejects blanks and non-fund ISINs', () => {
    expect(ownIsin(null)).toBeNull();
    expect(ownIsin('')).toBeNull();
    expect(ownIsin('INE002A01018')).toBeNull();
  });
});

describe('enrichMutualFunds', () => {
  it('uses the row ISIN when the statement name does not match AMFI', async () => {
    const db = fakeDb({
      nav_daily: [
        // Newest first, as the real query orders it. scheme_name deliberately
        // differs from the statement's wording, so name matching cannot find it.
        { isin: 'INF178L01095', amfi_code: '100299', nav: 70.199, nav_date: '2026-11-09', scheme_name: 'Kotak Infrastructure and Economic Reform Fund - Regular Plan - Growth Option' },
        { isin: 'INF178L01095', amfi_code: '100299', nav: 69.531, nav_date: '2026-11-06', scheme_name: 'Kotak Infrastructure and Economic Reform Fund - Regular Plan - Growth Option' },
      ],
      mf_scheme_cache: [
        { scheme_code: '100299', amfi_category: 'Equity Scheme - Sectoral/ Thematic', return_1y: 4.2, return_3y: 18.1, fund_house: 'Kotak Mahindra Mutual Fund' },
      ],
    });
    const [out] = await enrichMutualFunds(db, [
      fund({ name: 'Kotak Infrastructure & Economic Reform Fund Standard Growth (Regular Plan) (Non-Demat)', isin: 'INF178L01095' }),
    ]);
    expect(out.dayChangePct).toBeCloseTo((70.199 / 69.531 - 1) * 100, 6);
    expect(out.dayChange).toBeGreaterThan(0);
    expect(out.category).toBe('Sectoral/ Thematic');
    expect(out.fundReturn1y).toBe(4.2);
  });

  it('leaves a row untouched when nothing can be found', async () => {
    const db = fakeDb({ nav_daily: [{ isin: 'INF000000001', amfi_code: null, nav: 10, nav_date: '2026-11-09', scheme_name: 'Other' }] });
    const row = fund({ name: 'Unknown Fund', isin: null });
    expect(await enrichMutualFunds(db, [row])).toEqual([row]);
  });
});
