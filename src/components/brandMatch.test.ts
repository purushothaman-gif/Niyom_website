import { describe, expect, it } from 'vitest';
import { brandKey, coreKey, issuerFromBondName, lookupKeys } from './brandMatch';

describe('issuerFromBondName', () => {
  // Real bm_bonds.bond_name values that have no issuer link.
  it.each([
    ['10.25% MUTHOOT MERCANTILE LIMITED 2029', 'MUTHOOT MERCANTILE LIMITED'],
    ['10.05%  MUTHOOT FINCORP LIMITED 2029', 'MUTHOOT FINCORP LIMITED'],
    ['10% KOSAMATTAM FINANCE LIMITED 2029', 'KOSAMATTAM FINANCE LIMITED'],
    ['0.00% CYQURE INDIA PRIVATE LIMITED 2028', 'CYQURE INDIA PRIVATE LIMITED'],
    ['10.25% TATA CAPITAL LIMITED PERP CALL 2030', 'TATA CAPITAL LIMITED'],
    ['10.50% SHARE INDIA SECURITIES LIMITED 2028\r\n(VALUE DATE - 5 AUG 2026)', 'SHARE INDIA SECURITIES LIMITED'],
    ['11.50% INDEL MONEY LMITED 2032\r\n(SECONDARY TRADE WILL START FROM 27 AUG 2026)', 'INDEL MONEY LMITED'],
    ['/ 7.60% NHAI 11-JAN-2031', 'NHAI'],
    ['/8.63% IIFCL Tax Free 2028 (Reset Coupon: @ 8.38%)', 'IIFCL'],
    ['/8.71% REC LTD TAX FREE', 'REC LTD'],
    ['9.62ANDHRA PRADESH STATE BEVERAGES CORPORATION LIMITED', 'ANDHRA PRADESH STATE BEVERAGES CORPORATION LIMITED'],
    ['9.10% AKME FINTRADE INDIA LIMITED 10.03.2029', 'AKME FINTRADE INDIA LIMITED'],
    ['9.00% SAMMAAN CAPITAL LIMITED NCD 28-09-2027', 'SAMMAAN CAPITAL LIMITED'],
    ['8.10% State Bank of India Perp call', 'State Bank of India'],
    ['9.00% Canara Bank AT1', 'Canara Bank'],
    ['9.50% ICL FINCORP LIMITED AUG', 'ICL FINCORP LIMITED'],
    ['7.74%/7.49% IREDA TAX FREE 2031', 'IREDA'],
    ['8.20%/8.35 HUDCO TAX FREE 2027', 'HUDCO'],
    ['7.39% / 7.69% NHAI 2031', 'NHAI'],
    ['8.95% KERALA INFRASTRUCTURE\r\nINVESTMENT FUND BOARD 2033', 'KERALA INFRASTRUCTURE INVESTMENT FUND BOARD'],
    ['6.94% GS 2036', 'GS'],
  ])('%s → %s', (bond, issuer) => {
    expect(issuerFromBondName(bond)).toBe(issuer);
  });

  it('is empty for nothing', () => {
    expect(issuerFromBondName(null)).toBe('');
  });
});

describe('lookupKeys', () => {
  it('drops corporate suffixes so spelling variants meet', () => {
    expect(coreKey(brandKey('PAISALO DIGITAL LTD'))).toBe(coreKey(brandKey('PAISALO DIGITAL LIMITED')));
    expect(coreKey(brandKey('INDEL MONEY LMITED'))).toBe(coreKey(brandKey('INDEL MONEY  LIMITED')));
    expect(coreKey(brandKey('AKARA CAPITAL ADVISORS PVT LTD'))).toBe(coreKey(brandKey('AKARA CAPITAL ADVISORS PRIVATE LIMITED')));
    expect(coreKey(brandKey('AKME FINTRADE INDIA LIMITED'))).toBe(coreKey(brandKey('AKME FINTRADE (INDIA) LIMITED')));
  });

  it('maps short forms to the full issuer', () => {
    expect(lookupKeys('REC LTD')).toContain('ruralelectrificationcorporation');
    expect(lookupKeys('SBI')).toContain('statebankofindia');
  });
});
