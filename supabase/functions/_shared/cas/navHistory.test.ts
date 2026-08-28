/**
 * The historical NAV report — a different file from the daily one.
 *
 * Lines are verbatim from AMFI's report for 31-Jan-2018, the day equity
 * grandfathering is measured on. The whole point of this module is that its
 * layout differs from NAVAll.txt, so the tests are mostly about not confusing
 * the two.
 */
import { describe, expect, it } from 'vitest';
import { parseAmfiNavHistory, toAmfiDate } from './navHistory.ts';
import { parseAmfiNav } from './nav.ts';

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

describe('the report AMFI serves now', () => {
  /** Verbatim from the report for 27-Aug-2026: plan and option in, prices out. */
  const HISTORY_WITH_PLAN = [
    'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date',
    '',
    'Open Ended Schemes ( Equity Schemes - ELSS- Tax Saver Fund )',
    '',
    'Quant Mutual Fund',
    '',
    '120847;Quant ELSS Tax Saver Fund;Direct Plan;Growth Option;INF966L01986;-;467.1777;27-Aug-2026',
    '120846;Quant ELSS Tax Saver Fund;Direct Plan;IDCW Option;INF966L01960;INF966L01127;62.2768;27-Aug-2026',
  ].join('\n');

  it('reads ISINs from where they moved to, not where they used to be', () => {
    /*
     * The ISINs shifted from columns 2 and 3 to 4 and 5. Read by position, the
     * old reader tested "Direct Plan" against the ISIN pattern, matched
     * nothing, and every backfill returned zero rows for every date — reported
     * as "a non-trading day, or the layout changed".
     */
    const rows = parseAmfiNavHistory(HISTORY_WITH_PLAN);
    const quant = rows.find((r) => r.isin === 'INF966L01986');
    expect(quant?.nav).toBe(467.1777);
    expect(quant?.nav_date).toBe('2026-08-27');
    expect(quant?.amfi_code).toBe('120847');
  });

  it('reads both ISINs of a scheme against the same NAV', () => {
    const rows = parseAmfiNavHistory(HISTORY_WITH_PLAN);
    expect(rows.find((r) => r.isin === 'INF966L01960')?.nav).toBe(62.2768);
    expect(rows.find((r) => r.isin === 'INF966L01127')?.nav).toBe(62.2768);
  });

  it('keeps plan and option in the name, which no longer carries them', () => {
    const rows = parseAmfiNavHistory(HISTORY_WITH_PLAN);
    expect(rows.find((r) => r.isin === 'INF966L01986')?.scheme_name).toBe(
      'Quant ELSS Tax Saver Fund - Direct Plan - Growth Option',
    );
  });

  it('ignores headings, AMC names and the header row', () => {
    const rows = parseAmfiNavHistory(HISTORY_WITH_PLAN);
    expect(rows).toHaveLength(3); // 2 schemes, one of which has two ISINs
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

  /**
   * The current daily file — header included, and eight columns wide like the
   * historical report. The column COUNT no longer separates the two files, so
   * the header has to.
   */
  const DAILY_NOW = [
    'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
    'Open Ended Schemes(Equity Scheme - Large Cap Fund)',
    '103174;INF209K01BR9;INF209K01EC5;Aditya Birla Sun Life Large Cap Fund;Direct Plan;Growth Option;226.6;27-Aug-2026',
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

  it('the historical parser reads nothing from the CURRENT daily file', () => {
    /*
     * Both files are eight columns now. Positionally, a daily row offers the
     * historical reader a real ISIN in column 2 — its reinvestment ISIN — and
     * would pair it with "Direct Plan" as a NAV. The header is what refuses it.
     */
    expect(parseAmfiNavHistory(DAILY_NOW)).toHaveLength(0);
  });

  it('the daily parser reads nothing from the current historical report', () => {
    const historyNow = [
      'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date',
      '120847;Quant ELSS Tax Saver Fund;Direct Plan;Growth Option;INF966L01986;-;467.1777;27-Aug-2026',
    ].join('\n');
    expect(parseAmfiNav(historyNow).navs).toHaveLength(0);
  });
});
