import { describe, expect, it } from 'vitest';
import { curatedBonds, popularFunds } from './explorePicks';

const bond = (issuer: string, rating: string, ytm: number, maturity: string | null = '2099-01-01') => ({
  issuer_name: issuer,
  bond_name: `${issuer} NCD`,
  isin: issuer,
  coupon_rate: ytm,
  maturity_date: maturity,
  rating,
  analytics: { ytm },
});

describe('curatedBonds', () => {
  const now = new Date('2026-11-12');

  it('keeps one bond per issuer among AA-or-better, highest yield first', () => {
    const out = curatedBonds(
      [
        bond('A Ltd', 'CRISIL AA', 9),
        bond('A Ltd', 'CRISIL AA', 10),
        bond('B Ltd', 'ICRA AAA', 8),
        bond('C Ltd', 'CARE AA+', 11),
        bond('D Ltd', 'IND AA-', 9.5),
        bond('E Ltd', 'CARE BBB', 14),
      ],
      { now },
    );
    expect(out.map((b) => [b.issuer_name, b.analytics.ytm])).toEqual([
      ['C Ltd', 11],
      ['A Ltd', 10],
      ['D Ltd', 9.5],
      ['B Ltd', 8],
    ]);
  });

  it('widens to lower grades when fewer than four qualify, and drops matured bonds', () => {
    const out = curatedBonds(
      [bond('A Ltd', 'AAA', 8), bond('B Ltd', 'BBB', 13), bond('C Ltd', 'AAA', 9, '2020-01-01')],
      { now },
    );
    expect(out.map((b) => b.issuer_name)).toEqual(['A Ltd', 'B Ltd']);
  });

  it('puts issuers with a logo first when the surface has logos', () => {
    const out = curatedBonds(
      [bond('A Ltd', 'AAA', 12), bond('B Ltd', 'AA', 8), bond('C Ltd', 'A', 9)],
      { now, hasLogo: (b) => b.issuer_name !== 'A Ltd' },
    );
    expect(out.map((b) => b.issuer_name)).toEqual(['B Ltd', 'C Ltd', 'A Ltd']);
  });
});

describe('popularFunds', () => {
  const f = (amfiCode: string) => ({ amfiCode });
  it('lists staff picks first, then category leaders round-robin without repeats', () => {
    const all = ['1', '2', '3', '4', '5'].map(f);
    const out = popularFunds(all, ['3', 'missing'], [[f('1'), f('2')], [f('3'), f('4')]], 4);
    expect(out.map((x) => x.amfiCode)).toEqual(['3', '1', '2', '4']);
  });
});
