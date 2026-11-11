/**
 * The parse → demat-rows mapping.
 *
 * Pinned because a holding the mapper drops, or files under the wrong class,
 * shows a client a net worth that is quietly wrong — the one thing this import
 * must never do.
 */
import { describe, expect, it } from 'vitest';
import { mapParseToDemat, type ParsedCas } from './casparserCdsl.js';

const sample: ParsedCas = {
  meta: { cas_type: 'CDSL', statement_period: { to: '2026-10-31' } },
  investor: { name: 'Sankar R', pan: 'ABCDE1234F' },
  summary: { total_value: 1_250_000 },
  demat_accounts: [
    {
      demat_type: 'CDSL',
      dp_id: '12088700',
      dp_name: 'Zerodha',
      bo_id: '1208870012345678',
      value: 1_200_000,
      holdings: {
        equities: [{ isin: 'INE002A01018', name: 'Reliance', units: 50, value: 700_000, pledged: 0 }],
        corporate_bonds: [
          { isin: 'INE123A07AB1', issuer: 'Tata Capital', units: 5, value: 500_000, coupon: 8.5, maturity: '2028-06-01' },
        ],
        government_securities: [{ isin: 'IN0020230069', name: '7.18% GS 2033', units: 100, value: 0 }],
      },
    },
  ],
  nps: [{ isin: null, name: 'NPS Tier I', units: 1000, value: 50_000, pran: '110012345678' }],
};

describe('mapParseToDemat', () => {
  const mapped = mapParseToDemat(sample);

  it('carries the statement header', () => {
    expect(mapped.casType).toBe('CDSL');
    expect(mapped.statementDate).toBe('2026-10-31');
    expect(mapped.investorPan).toBe('ABCDE1234F');
    expect(mapped.totalValue).toBe(1_250_000);
  });

  it('files each bucket under the right asset class and loses nothing', () => {
    const [acc, nps] = mapped.accounts;
    const classes = acc.holdings.map((h) => h.assetClass).sort();
    expect(classes).toEqual(['corporate_bond', 'equity', 'gsec']);
    expect(acc.boId).toBe('1208870012345678');
    expect(acc.holdings).toHaveLength(3);
    // NPS becomes its own synthetic account, not dropped.
    expect(nps.depository).toBe('NPS');
    expect(nps.holdings[0].assetClass).toBe('nps');
  });

  it('keeps class-specific fields in extra, not columns', () => {
    const bond = mapped.accounts[0].holdings.find((h) => h.assetClass === 'corporate_bond')!;
    expect(bond.value).toBe(500_000);
    expect(bond.extra.coupon).toBe(8.5);
    expect(bond.extra.maturity).toBe('2028-06-01');
    expect(bond.name).toBe('Tata Capital'); // falls back to issuer when no name
    expect(bond.extra).not.toHaveProperty('value');
  });

  it('keeps a zero-value holding rather than discarding it', () => {
    const gsec = mapped.accounts[0].holdings.find((h) => h.assetClass === 'gsec')!;
    expect(gsec.value).toBe(0);
    expect(gsec.units).toBe(100);
  });

  it('puts an unknown bucket under "other" instead of dropping it', () => {
    const odd = mapParseToDemat({
      demat_accounts: [{ holdings: { reits: [{ isin: 'INE0XX', name: 'Embassy REIT', value: 9 }] } }],
    });
    expect(odd.accounts[0].holdings[0].assetClass).toBe('other');
    expect(odd.accounts[0].holdings[0].value).toBe(9);
  });

  it('survives an empty statement', () => {
    const empty = mapParseToDemat({});
    expect(empty.accounts).toEqual([]);
    expect(empty.totalValue).toBeNull();
  });
});
