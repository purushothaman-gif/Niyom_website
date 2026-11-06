import { describe, expect, it } from 'vitest';
import { mfapiDateToIso, mfapiToNavRows } from './navScheme.ts';

describe('mfapi history → nav_daily rows', () => {
  it('converts dd-mm-yyyy to ISO and rejects junk', () => {
    expect(mfapiDateToIso('05-11-2026')).toBe('2026-11-05');
    expect(mfapiDateToIso('2026-11-05')).toBeNull();
    expect(mfapiDateToIso('')).toBeNull();
  });

  it('keeps positive NAVs once per date', () => {
    const rows = mfapiToNavRows('INF179K01BB8', '100123', [
      { date: '05-11-2026', nav: '123.4567' },
      { date: '05-11-2026', nav: '999' },     // duplicate date: first wins
      { date: '04-11-2026', nav: '0.00000' }, // zero NAV: dropped
      { date: '03-11-2026', nav: 'N.A.' },    // unparsable: dropped
      { date: 'bad', nav: '10' },
    ]);
    expect(rows).toEqual([
      { isin: 'INF179K01BB8', nav_date: '2026-11-05', nav: 123.4567, amfi_code: '100123' },
    ]);
  });
});
