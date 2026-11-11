import { describe, expect, it } from 'vitest';

import { nameKey, pickScheme } from './curatedFundPick.ts';

const c = (scheme_code: string, scheme_name: string) => ({ scheme_code, scheme_name });

describe('curated fund resolution', () => {
  it('ignores spacing and punctuation in names', () => {
    expect(nameKey('UTI - Flexi Cap Fund.')).toBe(nameKey('UTI Flexi Cap Fund'));
    expect(nameKey('Kotak Flexicap Fund')).toBe(nameKey('Kotak Flexi Cap Fund'));
    expect(nameKey('ICICI Prudential Equity & Debt Fund')).toBe(nameKey('ICICI Prudential Equity and Debt Fund'));
  });

  it('prefers the plain plan over bonus / institutional / PF variants', () => {
    const live = [
      c('106240', 'Nippon India Large Cap Fund- Growth Plan Bonus Option'),
      c('106235', 'Nippon India Large Cap Fund'),
      c('133772', 'Kotak Corporate Bond Fund- Institutional Plan-Growth Option'),
      c('133782', 'Kotak Corporate Bond Fund'),
    ];
    expect(pickScheme(live, ['Nippon India Large Cap Fund'])).toBe(106235);
    expect(pickScheme(live, ['Kotak Corporate Bond Fund'])).toBe(133782);
  });

  it('takes the original (lowest) code when several plain plans share a name', () => {
    const live = [c('101934', 'SBI GILT FUND'), c('101001', 'SBI GILT FUND'), c('101932', 'SBI GILT FUND')];
    expect(pickScheme(live, ['SBI Magnum Gilt Fund', 'SBI Gilt Fund'])).toBe(101001);
  });

  it('follows a rename through aka, and finds an "erstwhile" label', () => {
    const live = [
      c('108466', 'ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund)'),
      c('154450', 'ICICI Prudential Multi-Asset Active FOF'),
      c('101144', 'ICICI Prudential Multi Asset Allocation Fund'),
    ];
    expect(pickScheme(live, ['ICICI Prudential Bluechip Fund', 'ICICI Prudential Large Cap Fund'])).toBe(108466);
    expect(pickScheme(live, ['ICICI Prudential Multi-Asset Fund', 'ICICI Prudential Multi Asset Allocation Fund'])).toBe(101144);
  });

  it('returns null rather than a wrong fund', () => {
    expect(pickScheme([c('1', 'Axis Midcap Fund')], ['Axis Small Cap Fund'])).toBeNull();
    expect(pickScheme([], ['Anything'])).toBeNull();
  });
});
