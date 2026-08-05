/**
 * Reading AMFI's daily file — NAVs, and the category each scheme sits under.
 *
 * Lines are verbatim from NAVAll.txt (05-Aug-2026). The category half is new and
 * carries the sharper risk: a NAV that fails to parse leaves a holding at its
 * statement value, which is visibly stale, while a category attached to the
 * wrong scheme produces a tax rate that looks completely ordinary and is wrong.
 */
import { describe, expect, it } from 'vitest';
import { parseAmfiNav } from './nav.ts';

/** A fragment of the real file: heading, AMC, scheme rows. */
const FILE = [
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
  '',
  'Open Ended Schemes(Equity Scheme - Large Cap Fund)',
  '',
  'Aditya Birla Sun Life Mutual Fund',
  '',
  '103174;INF209K01BR9;INF209K01EC5;Aditya Birla Sun Life Large Cap Fund-Growth;226.6;05-Aug-2026',
  '',
  'Open Ended Schemes(Debt Scheme - Liquid Fund)',
  '',
  'IL&FS Mutual Fund (IDF)',
  '',
  '119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla Sun Life Liquid Fund;100.7401;05-Aug-2026',
  '',
  'Open Ended Schemes(Hybrid Scheme - Multi Asset Allocation)',
  '',
  '148918;INF200K01VT2;-;SBI Multi Asset Allocation Fund Regular Growth;66.67;05-Aug-2026',
  '',
  '999999;INF999X01AB1;-;A Fund Yet To Declare;N.A.;05-Aug-2026',
].join('\n');

describe('NAV rows', () => {
  it('reads both ISINs of a scheme against the same NAV', () => {
    const { navs } = parseAmfiNav(FILE);
    const growth = navs.find((n) => n.isin === 'INF209K01BR9');
    const reinvest = navs.find((n) => n.isin === 'INF209K01EC5');
    expect(growth?.nav).toBe(226.6);
    expect(reinvest?.nav).toBe(226.6);
    expect(growth?.nav_date).toBe('2026-08-05');
    expect(growth?.amfi_code).toBe('103174');
  });

  it('skips a scheme that has not declared a NAV', () => {
    // "N.A." is a real absence. A zero would be a price, and a wrong one.
    const { navs } = parseAmfiNav(FILE);
    expect(navs.some((n) => n.isin === 'INF999X01AB1')).toBe(false);
  });

  it('still classifies a scheme that has no NAV', () => {
    /*
     * A wound-up fund keeps its category and loses its price. Two of the 82
     * ISINs held across the book are exactly that — closed funds whose units
     * were redeemed, so they carry realised gains that must be taxed at the
     * right rate. Gating classification on a usable NAV silently dropped both.
     */
    const { navs, classes } = parseAmfiNav(FILE);
    expect(navs.some((n) => n.isin === 'INF999X01AB1')).toBe(false);
    expect(classes.find((c) => c.isin === 'INF999X01AB1')?.amfi_category).toBe(
      'Hybrid Scheme - Multi Asset Allocation',
    );
  });

  it('ignores a "-" in the second ISIN column', () => {
    const { navs } = parseAmfiNav(FILE);
    expect(navs.filter((n) => n.isin === 'INF200K01VT2')).toHaveLength(1);
    expect(navs.some((n) => n.isin === '-')).toBe(false);
  });
});

describe('the category each scheme was printed under', () => {
  it('attaches the heading above the scheme, not the one below it', () => {
    const { classes } = parseAmfiNav(FILE);
    const by = (isin: string) => classes.find((c) => c.isin === isin);

    expect(by('INF209K01BR9')?.amfi_category).toBe('Equity Scheme - Large Cap Fund');
    expect(by('INF209K01BR9')?.asset_class).toBe('equity');
    expect(by('INF209KA12Z1')?.amfi_category).toBe('Debt Scheme - Liquid Fund');
    expect(by('INF209KA12Z1')?.asset_class).toBe('debt');
  });

  it('classifies both ISINs of a scheme the same way', () => {
    // Growth and reinvestment plans are one fund holding one portfolio; taxing
    // them differently because of a parse quirk would be indefensible.
    const { classes } = parseAmfiNav(FILE);
    const growth = classes.find((c) => c.isin === 'INF209K01BR9');
    const reinvest = classes.find((c) => c.isin === 'INF209K01EC5');
    expect(reinvest?.asset_class).toBe(growth?.asset_class);
    expect(reinvest?.amfi_category).toBe(growth?.amfi_category);
  });

  it('does not let an AMC name with brackets become a category', () => {
    /*
     * `IL&FS Mutual Fund (IDF)` sits between the Liquid Fund heading and its
     * schemes. Read as a heading it would wipe the real category and leave every
     * fund beneath it unclassified — or worse, classified as something else.
     */
    const { classes } = parseAmfiNav(FILE);
    expect(classes.find((c) => c.isin === 'INF209KA12Z1')?.amfi_category).toBe(
      'Debt Scheme - Liquid Fund',
    );
    expect(classes.some((c) => c.amfi_category.includes('IDF'))).toBe(false);
  });

  it('marks a category that cannot decide the equity share', () => {
    const { classes } = parseAmfiNav(FILE);
    const sbi = classes.find((c) => c.isin === 'INF200K01VT2');
    expect(sbi?.amfi_category).toBe('Hybrid Scheme - Multi Asset Allocation');
    expect(sbi?.ambiguous).toBe(true);
  });

  it('classifies a scheme once, under the first heading it appears beneath', () => {
    /*
     * AMFI repeats some schemes across categories. Taking the last occurrence
     * would let a duplicate listing change a fund's tax treatment between one
     * evening's file and the next, with nothing to show for it.
     */
    const repeated = [
      'Open Ended Schemes(Equity Scheme - Large Cap Fund)',
      '103174;INF209K01BR9;-;A Fund;226.6;05-Aug-2026',
      'Open Ended Schemes(Debt Scheme - Liquid Fund)',
      '103174;INF209K01BR9;-;A Fund;226.6;05-Aug-2026',
    ].join('\n');
    const { classes } = parseAmfiNav(repeated);
    expect(classes).toHaveLength(1);
    expect(classes[0].asset_class).toBe('equity');
  });

  it('leaves a scheme unclassified when no heading has been seen yet', () => {
    // Better absent than attributed to whatever heading happened to be in scope.
    const { classes } = parseAmfiNav('103174;INF209K01BR9;-;A Fund;226.6;05-Aug-2026');
    expect(classes).toHaveLength(0);
  });
});
