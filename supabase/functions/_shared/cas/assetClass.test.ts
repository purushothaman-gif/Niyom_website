/**
 * Scheme classification, against AMFI's real category list.
 *
 * Every heading below is verbatim from NAVAll.txt as published on 05-Aug-2026 —
 * all 90 of them. Invented categories would prove nothing: the whole risk here
 * is that AMFI spells things two ways ("Equity Scheme -" and "Equity Schemes -",
 * both live in the same file) or files a fund somewhere unexpected.
 *
 * A wrong class is not a cosmetic bug. It moves a holding between a 12-month and
 * a 24-month long-term threshold and between a 12.5% and a slab rate, and the
 * resulting number looks entirely ordinary on screen.
 */
import { describe, expect, it } from 'vitest';
import { classifyCategory, readCategoryHeading } from './assetClass.ts';

const classOf = (c: string) => classifyCategory(c).assetClass;
const isAmbiguous = (c: string) => classifyCategory(c).ambiguous;

describe('reading the heading out of the file', () => {
  it('takes the category from each of the three scheme-type prefixes', () => {
    expect(readCategoryHeading('Open Ended Schemes(Equity Scheme - Large Cap Fund)')).toBe(
      'Equity Scheme - Large Cap Fund',
    );
    expect(readCategoryHeading('Close Ended Schemes(ELSS)')).toBe('ELSS');
    expect(readCategoryHeading('Interval Fund Schemes(Income)')).toBe('Income');
  });

  it('normalises the spacing the two AMFI files disagree on', () => {
    // The daily file writes "Schemes(Income)"; the historical report writes
    // "Schemes ( Income )". Same category, and it must not become two rows.
    expect(readCategoryHeading('Open Ended Schemes ( Income )')).toBe('Income');
    expect(readCategoryHeading('Open Ended Schemes(Other Scheme - Other  ETFs)')).toBe(
      'Other Scheme - Other ETFs',
    );
  });

  it('does not mistake an AMC name for a category', () => {
    /*
     * The one line in the whole file that would break a naive "(" check. Read as
     * a category, it would reclassify every scheme printed beneath it.
     */
    expect(readCategoryHeading('IL&FS Mutual Fund (IDF)')).toBeNull();
    expect(readCategoryHeading('Aditya Birla Sun Life Mutual Fund')).toBeNull();
    expect(readCategoryHeading('119551;INF209KA12Z1;INF209KA13Z9;Fund;100.74;31-Jul-2026')).toBeNull();
  });
});

describe('equity-oriented — 12 months to long-term, 12.5% over the exemption', () => {
  it('accepts both spellings of every equity category AMFI publishes', () => {
    for (const c of [
      'Equity Scheme - Contra Fund',
      'Equity Scheme - Dividend Yield Fund',
      'Equity Scheme - ELSS',
      'Equity Scheme - Flexi Cap Fund',
      'Equity Scheme - Focused Fund',
      'Equity Scheme - Large & Mid Cap Fund',
      'Equity Scheme - Large Cap Fund',
      'Equity Scheme - Mid Cap Fund',
      'Equity Scheme - Multi Cap Fund',
      'Equity Scheme - Sectoral/ Thematic',
      'Equity Scheme - Small Cap Fund',
      'Equity Scheme - Value Fund',
      // The plural set — the same categories, filed differently in the same file.
      'Equity Schemes - Contra Fund',
      'Equity Schemes - ELSS- Tax Saver Fund',
      'Equity Schemes - Flexi Cap Fund',
      'Equity Schemes - Focused Fund',
      'Equity Schemes - Large & Mid Cap Fund',
      'Equity Schemes - Large Cap Fund',
      'Equity Schemes - Mid Cap Fund',
      'Equity Schemes - Multi Cap Fund',
      'Equity Schemes - Sectoral Fund',
      'Equity Schemes - Small Cap Fund',
      'Equity Schemes - Thematic Fund',
      'Equity Schemes - Value Fund',
    ]) {
      expect(classOf(c), c).toBe('equity');
      expect(isAmbiguous(c), c).toBe(false);
    }
  });

  it('treats the structurally equity-oriented hybrids as equity', () => {
    // Aggressive hybrid is 65-80% equity by mandate; arbitrage holds equity
    // fully hedged; equity savings must keep 65% in equity and equity-related
    // instruments. All three are built to qualify, so none is a judgement call.
    for (const c of [
      'Hybrid Scheme - Aggressive Hybrid Fund',
      'Hybrid Schemes - Aggressive Hybrid Fund',
      'Hybrid Scheme - Arbitrage Fund',
      'Hybrid Schemes - Arbitrage Fund',
      'Hybrid Scheme - Equity Savings',
      'Hybrid Schemes - Equity Savings Fund',
    ]) {
      expect(classOf(c), c).toBe('equity');
      expect(isAmbiguous(c), c).toBe(false);
    }
  });

  it('reads equity ETFs and equity index funds as equity', () => {
    for (const c of [
      'Exchange Traded Funds (ETFs) - Equity ETF',
      'Index Funds - Equity Funds',
    ]) {
      expect(classOf(c), c).toBe('equity');
      expect(isAmbiguous(c), c).toBe(false);
    }
  });

  it('reads ELSS as equity wherever it is filed', () => {
    // 80% equity by statute, so the close-ended bucket changes nothing.
    expect(classOf('Close Ended Schemes(ELSS)')).toBe('equity');
    expect(classOf('ELSS')).toBe('equity');
    expect(isAmbiguous('ELSS')).toBe(false);
  });
});

describe('debt — a specified fund, with no long-term treatment after 01-Apr-2023', () => {
  it('covers every debt category, in both of AMFI’s spellings', () => {
    for (const c of [
      'Debt Scheme - Banking and PSU Fund',
      'Debt Scheme - Corporate Bond Fund',
      'Debt Scheme - Credit Risk Fund',
      'Debt Scheme - Dynamic Bond',
      'Debt Scheme - Floater Fund',
      'Debt Scheme - Gilt Fund',
      'Debt Scheme - Gilt Fund with 10 year constant duration',
      'Debt Scheme - Liquid Fund',
      'Debt Scheme - Long Duration Fund',
      'Debt Scheme - Low Duration Fund',
      'Debt Scheme - Medium Duration Fund',
      'Debt Scheme - Medium to Long Duration Fund',
      'Debt Scheme - Money Market Fund',
      'Debt Scheme - Overnight Fund',
      'Debt Scheme - Short Duration Fund',
      'Debt Scheme - Ultra Short Duration Fund',
      'Income/Debt Oriented Schemes - Banking and PSU Debt Fund',
      'Income/Debt Oriented Schemes - Corporate Bond Fund',
      'Income/Debt Oriented Schemes - Credit Risk Fund',
      'Income/Debt Oriented Schemes - Dynamic Term Fund',
      'Income/Debt Oriented Schemes - Gilt Fund',
      'Income/Debt Oriented Schemes - Liquid Fund',
      'Income/Debt Oriented Schemes - Medium Term Fund',
      'Income/Debt Oriented Schemes - Money Market Fund',
      'Income/Debt Oriented Schemes - Overnight Fund',
      'Income/Debt Oriented Schemes - Short Term Fund',
      'Income/Debt Oriented Schemes - Ultra Short Term Fund',
      'Income/Debt Oriented Schemes - Ultra Short to Short Term Fund',
    ]) {
      expect(classOf(c), c).toBe('debt');
      expect(isAmbiguous(c), c).toBe(false);
    }
  });

  it('reads a debt index fund as debt, not as an index fund', () => {
    /*
     * The ordering trap. "Index Funds - Debt Funds" contains the word "Funds"
     * and sits next to the equity index heading; matched in the wrong order it
     * becomes equity, and a gilt index fund gets a 12-month long-term threshold
     * it is not entitled to.
     */
    expect(classOf('Index Funds - Debt Funds')).toBe('debt');
    expect(classOf('Exchange Traded Funds (ETFs) - Debt ETF')).toBe('debt');
  });

  it('reads a conservative hybrid as debt', () => {
    // 75-90% debt — past the 65% bar that defines a specified fund.
    expect(classOf('Hybrid Scheme - Conservative Hybrid Fund')).toBe('debt');
    expect(isAmbiguous('Hybrid Scheme - Conservative Hybrid Fund')).toBe(false);
  });

  it('reads the legacy pre-2018 debt buckets as debt', () => {
    for (const c of ['Income', 'Gilt', 'Money Market']) {
      expect(classOf(c), c).toBe('debt');
      expect(isAmbiguous(c), c).toBe(false);
    }
  });
});

describe('other — neither equity-oriented nor debt-dominated, long-term at 24 months', () => {
  it('covers gold, silver, overseas and the balanced hybrid', () => {
    for (const c of [
      'Exchange Traded Funds (ETFs) - Gold ETF',
      'Exchange Traded Funds (ETFs) - Silver ETF',
      'Exchange Traded Funds (ETFs) - Other ETF',
      'Other Scheme - Gold ETF',
      'Other Scheme - Other ETFs',
      'Other Scheme - FoF Overseas',
      'Overseas Fund of Funds - Fund of Funds investing overseas',
      // 40-60% equity: too little to be equity-oriented, too much to be debt.
      'Hybrid Scheme - Balanced Hybrid Fund',
    ]) {
      expect(classOf(c), c).toBe('other');
      expect(isAmbiguous(c), c).toBe(false);
    }
  });
});

describe('undecided — where the category genuinely cannot answer', () => {
  it('refuses to classify the four that our clients actually hold', () => {
    /*
     * Fourteen of the 82 schemes held across the book fall here. Each would take
     * a plausible-looking default, and each would be wrong for some real fund:
     * SBI Multi Asset sits below 65% equity while ICICI's sits above it, and
     * both are filed under the same heading.
     */
    for (const c of [
      'Hybrid Scheme - Multi Asset Allocation',
      'Hybrid Schemes - Multi Asset Allocation Fund',
      'Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage',
      'Hybrid Schemes - Balanced Advantage Fund/ Dynamic Asset Allocation',
      'Other Scheme - FoF Domestic',
      'Fund of Funds Scheme (Domestic) - Fund of Funds Scheme (Domestic)',
      'Other Scheme - Index Funds',
    ]) {
      expect(isAmbiguous(c), c).toBe(true);
    }
  });

  it('refuses the solution-oriented and life-cycle buckets', () => {
    for (const c of [
      'Solution Oriented Scheme - Children’s Fund',
      'Solution Oriented Scheme - Retirement Fund',
      'Life Cycle Funds - Life Cycle Fund with Maturity of 10 Years',
      'Life Cycle Funds - Life Cycle Fund with Maturity of 15 Years',
    ]) {
      expect(isAmbiguous(c), c).toBe(true);
    }
  });

  it('refuses the legacy "Growth" catch-all', () => {
    // Mostly equity growth schemes, but the heading carries nothing to confirm
    // it and the funds filed here are old enough to have long histories.
    expect(isAmbiguous('Growth')).toBe(true);
  });

  it('refuses a category it has never seen', () => {
    /*
     * AMFI adds categories — Silver ETF appeared in 2021. A new heading falling
     * through to a default would tax a fund at a rate nobody chose, and nothing
     * on screen would look wrong. Undecided surfaces as a prompt instead.
     */
    expect(isAmbiguous('Equity Scheme - Quantum Entanglement Fund')).toBe(false); // matches equity
    expect(isAmbiguous('Some Brand New Category AMFI Invented')).toBe(true);
    expect(isAmbiguous('')).toBe(true);
  });
});

describe('the full published list is accounted for', () => {
  /*
   * A guard against silent drift: every one of AMFI's 90 headings must land on a
   * rule deliberately, and the ambiguous set must stay small enough to resolve by
   * hand. If AMFI renames a category this test is what notices.
   */
  const ALL = [
    'ELSS', 'Growth', 'Income', 'Income', 'Debt Scheme - Banking and PSU Fund',
    'Debt Scheme - Corporate Bond Fund', 'Debt Scheme - Credit Risk Fund',
    'Debt Scheme - Dynamic Bond', 'Debt Scheme - Floater Fund',
    'Debt Scheme - Gilt Fund with 10 year constant duration', 'Debt Scheme - Gilt Fund',
    'Debt Scheme - Liquid Fund', 'Debt Scheme - Long Duration Fund',
    'Debt Scheme - Low Duration Fund', 'Debt Scheme - Medium Duration Fund',
    'Debt Scheme - Medium to Long Duration Fund', 'Debt Scheme - Money Market Fund',
    'Debt Scheme - Overnight Fund', 'Debt Scheme - Short Duration Fund',
    'Debt Scheme - Ultra Short Duration Fund', 'Equity Scheme - Contra Fund',
    'Equity Scheme - Dividend Yield Fund', 'Equity Scheme - ELSS',
    'Equity Scheme - Flexi Cap Fund', 'Equity Scheme - Focused Fund',
    'Equity Scheme - Large & Mid Cap Fund', 'Equity Scheme - Large Cap Fund',
    'Equity Scheme - Mid Cap Fund', 'Equity Scheme - Multi Cap Fund',
    'Equity Scheme - Sectoral/ Thematic', 'Equity Scheme - Small Cap Fund',
    'Equity Scheme - Value Fund', 'Equity Schemes - Contra Fund',
    'Equity Schemes - ELSS- Tax Saver Fund', 'Equity Schemes - Flexi Cap Fund',
    'Equity Schemes - Focused Fund', 'Equity Schemes - Large & Mid Cap Fund',
    'Equity Schemes - Large Cap Fund', 'Equity Schemes - Mid Cap Fund',
    'Equity Schemes - Multi Cap Fund', 'Equity Schemes - Sectoral Fund',
    'Equity Schemes - Small Cap Fund', 'Equity Schemes - Thematic Fund',
    'Equity Schemes - Value Fund', 'Exchange Traded Funds (ETFs) - Debt ETF',
    'Exchange Traded Funds (ETFs) - Equity ETF', 'Exchange Traded Funds (ETFs) - Gold ETF',
    'Exchange Traded Funds (ETFs) - Other ETF', 'Exchange Traded Funds (ETFs) - Silver ETF',
    'Fund of Funds Scheme (Domestic) - Fund of Funds Scheme (Domestic)', 'Gilt', 'Growth',
    'Hybrid Scheme - Aggressive Hybrid Fund', 'Hybrid Scheme - Arbitrage Fund',
    'Hybrid Scheme - Balanced Hybrid Fund', 'Hybrid Scheme - Conservative Hybrid Fund',
    'Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage',
    'Hybrid Scheme - Equity Savings', 'Hybrid Scheme - Multi Asset Allocation',
    'Hybrid Schemes - Aggressive Hybrid Fund', 'Hybrid Schemes - Arbitrage Fund',
    'Hybrid Schemes - Balanced Advantage Fund/ Dynamic Asset Allocation',
    'Hybrid Schemes - Equity Savings Fund', 'Hybrid Schemes - Multi Asset Allocation Fund',
    'Income', 'Income/Debt Oriented Schemes - Banking and PSU Debt Fund',
    'Income/Debt Oriented Schemes - Corporate Bond Fund',
    'Income/Debt Oriented Schemes - Credit Risk Fund',
    'Income/Debt Oriented Schemes - Dynamic Term Fund',
    'Income/Debt Oriented Schemes - Gilt Fund', 'Income/Debt Oriented Schemes - Liquid Fund',
    'Income/Debt Oriented Schemes - Medium Term Fund',
    'Income/Debt Oriented Schemes - Money Market Fund',
    'Income/Debt Oriented Schemes - Overnight Fund',
    'Income/Debt Oriented Schemes - Short Term Fund',
    'Income/Debt Oriented Schemes - Ultra Short Term Fund',
    'Income/Debt Oriented Schemes - Ultra Short to Short Term Fund',
    'Index Funds - Debt Funds', 'Index Funds - Equity Funds',
    'Life Cycle Funds - Life Cycle Fund with Maturity of 10 Years',
    'Life Cycle Funds - Life Cycle Fund with Maturity of 15 Years', 'Money Market',
    'Other Scheme - FoF Domestic', 'Other Scheme - FoF Overseas', 'Other Scheme - Gold ETF',
    'Other Scheme - Index Funds', 'Other Scheme - Other ETFs',
    'Overseas Fund of Funds - Fund of Funds investing overseas',
    'Solution Oriented Scheme - Children’s Fund',
    'Solution Oriented Scheme - Retirement Fund',
  ];

  it('leaves at most a handful undecided', () => {
    const undecided = [...new Set(ALL.filter(isAmbiguous))];
    // Multi Asset x2, BAF/DAA x2, FoF Domestic x2, Other-Index, Solution x2,
    // Life Cycle x2, Growth — every one a real composition question.
    expect(undecided.length).toBeLessThanOrEqual(12);
    expect(undecided).not.toContain('Equity Scheme - Large Cap Fund');
    expect(undecided).not.toContain('Debt Scheme - Liquid Fund');
  });

  it('never returns a class outside the three', () => {
    for (const c of ALL) {
      expect(['equity', 'debt', 'other'], c).toContain(classOf(c));
    }
  });
});
