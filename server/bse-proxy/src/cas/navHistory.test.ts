/**
 * The historical NAV report — a different file from the daily one.
 *
 * Lines are verbatim from AMFI's report for 31-Jan-2018, the day equity
 * grandfathering is measured on. The whole point of this module is that its
 * layout differs from NAVAll.txt, so the tests are mostly about not confusing
 * the two.
 */
import { describe, expect, it } from 'vitest';
import { parseAmfiNavHistory, toAmfiDate } from './navHistory.js';
import { parseAmfiNav } from './nav.js';

/** Real rows: header, heading, AMC, schemes. Note the 8 columns. */
const HISTORY = [
  'Scheme Code;Scheme Name;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date',
  '',
  'Open Ended Schemes ( Equity Scheme - Large Cap Fund )',
  '',
  'Aditya Birla Sun Life Mutual Fund',
  '',
  '103174;Aditya Birla Sun Life Large Cap Fund-Growth;INF209K01BR9;INF209K01EC5;226.6;;;31-Jan-2018',
  '108466;ICICI Prudential Large Cap Fund;INF109K01BL4;-;41.77;41.77;41.77;31-Jan-2018',
  '103098;UTI Value Fund - Regular Plan - Growth Option;INF789F01AG5;-;61.1073;;;31-Jan-2018',
].join('\n');

describe('turning a date into what the endpoint accepts', () => {
  it('formats an ISO date the way AMFI wants it', () => {
    expect(toAmfiDate('2018-01-31')).toBe('31-Jan-2018');
    expect(toAmfiDate('2026-08-05')).toBe('05-Aug-2026');
    expect(toAmfiDate('2020-12-01')).toBe('01-Dec-2020');
  });

  it('refuses anything that is not an ISO date', () => {
    // A silently mis-formatted date would fetch the wrong day, and the NAVs
    // would look perfectly reasonable.
    expect(() => toAmfiDate('31-Jan-2018')).toThrow();
    expect(() => toAmfiDate('2018-13-01')).toThrow();
    expect(() => toAmfiDate('')).toThrow();
  });
});

describe('parsing the historical report', () => {
  it('reads NAV, ISIN and date from the 8-column layout', () => {
    const rows = parseAmfiNavHistory(HISTORY);
    const icici = rows.find((r) => r.isin === 'INF109K01BL4');
    expect(icici?.nav).toBe(41.77);
    expect(icici?.nav_date).toBe('2018-01-31');
    expect(icici?.amfi_code).toBe('108466');
    expect(icici?.scheme_name).toContain('ICICI Prudential Large Cap');
  });

  it('takes the NAV, not the repurchase or sale price', () => {
    /*
     * The two extra columns are the trap. Reading position 5 or 6 instead of 4
     * gives a number that is close enough to look right and is not the NAV —
     * and on a fund with an exit load it differs by exactly the load.
     */
    const rows = parseAmfiNavHistory(
      '108466;A Fund;INF109K01BL4;-;41.77;39.68;42.30;31-Jan-2018',
    );
    expect(rows[0].nav).toBe(41.77);
  });

  it('reads both ISINs against the same NAV', () => {
    const rows = parseAmfiNavHistory(HISTORY);
    expect(rows.find((r) => r.isin === 'INF209K01BR9')?.nav).toBe(226.6);
    expect(rows.find((r) => r.isin === 'INF209K01EC5')?.nav).toBe(226.6);
  });

  it('ignores headings, AMC names and the header row', () => {
    const rows = parseAmfiNavHistory(HISTORY);
    expect(rows).toHaveLength(4); // 3 schemes, one of which has two ISINs
    expect(rows.every((r) => /^INF/.test(r.isin))).toBe(true);
  });
});

describe('the two AMFI layouts cannot be crossed', () => {
  /*
   * Both files are semicolon-delimited text of mutual fund NAVs from the same
   * organisation, and the column orders differ. If a future change ever points
   * one parser at the other's endpoint, it must produce NOTHING rather than
   * confidently wrong numbers — a scheme name read as an ISIN, or a sale price
   * read as a NAV.
   */
  const DAILY = [
    'Open Ended Schemes(Equity Scheme - Large Cap Fund)',
    '103174;INF209K01BR9;INF209K01EC5;Aditya Birla Sun Life Large Cap Fund-Growth;226.6;05-Aug-2026',
  ].join('\n');

  it('the daily parser reads nothing from the historical file', () => {
    // Historical rows split into 8, and the 6-column reader would take the
    // scheme NAME as an ISIN — which matches no ISIN pattern, so nothing lands.
    const { navs } = parseAmfiNav(HISTORY);
    expect(navs.filter((n) => n.nav_date === '2018-01-31')).toHaveLength(0);
  });

  it('the historical parser reads nothing from the daily file', () => {
    expect(parseAmfiNavHistory(DAILY)).toHaveLength(0);
  });
});
