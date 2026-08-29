/**
 * The marketplace filter.
 *
 * Two surfaces draw this filter — the website's modal and the app's sheet — and
 * both call these functions, so a bond that passes on one passes on the other.
 * The cases that matter are the boundaries (a bond at exactly 10% yield, at
 * exactly ₹1 L minimum) and the null handling, because "unknown" is not the same
 * answer as "does not match" to a client who has just narrowed to 8–10% and is
 * wondering where a bond went.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  collateralOf,
  countFilters,
  filterCategories,
  filterChips,
  matchesFilters,
  minInvOf,
  passMinInv,
  passTenure,
  passYield,
  payoutOf,
  ratingGrade,
  removeFilter,
  taxOf,
  tenureYearsOf,
  toggleFilter,
  yieldOf,
  type BondFilters,
} from './bondFilters';
import type { FilterableBond } from './bondMath';

function bond(over: Partial<FilterableBond> = {}): FilterableBond {
  return {
    coupon_rate: 9,
    coupon_frequency: 'monthly',
    maturity_date: null,
    rating: 'CARE AA-',
    security_type: 'secured',
    tax_status: 'taxable',
    min_investment: 100000,
    face_value: 100000,
    analytics: { ytm: 9.5, years_to_maturity: 2 },
    ...over,
  };
}

const filters = (over: Partial<BondFilters> = {}): BondFilters => ({ ...EMPTY_FILTERS, ...over });

describe('derivations', () => {
  it('prefers YTM over the coupon for yield', () => {
    expect(yieldOf(bond({ coupon_rate: 9, analytics: { ytm: 11 } }))).toBe(11);
  });

  it('falls back to the coupon when YTM is absent', () => {
    expect(yieldOf(bond({ coupon_rate: 9, analytics: null }))).toBe(9);
  });

  it('has no yield at all when neither is known', () => {
    expect(yieldOf(bond({ coupon_rate: null, analytics: null }))).toBeNull();
  });

  it('computes tenure from the maturity date when analytics are missing', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    const y = tenureYearsOf(bond({ analytics: null, maturity_date: future.toISOString() }));
    expect(y).toBeGreaterThan(4.9);
    expect(y).toBeLessThan(5.1);
  });

  it('rejects an unparseable maturity date rather than returning NaN', () => {
    expect(tenureYearsOf(bond({ analytics: null, maturity_date: 'soon' }))).toBeNull();
  });

  it('falls back to face value for the minimum investment', () => {
    expect(minInvOf(bond({ min_investment: null, face_value: 25000 }))).toBe(25000);
  });

  it('reads the grade out of an agency-prefixed rating', () => {
    expect(ratingGrade('CARE BBB-')).toBe('BBB');
    expect(ratingGrade('IND A+')).toBe('A');
    expect(ratingGrade('CRISIL AA-')).toBe('AA');
    expect(ratingGrade('ACUITE A-')).toBe('A');
    expect(ratingGrade(null)).toBeNull();
  });

  /*
   * Every one of these is a real string out of `bm_bonds`, and every one was
   * misread before the word boundaries went in: the grade was taken from an
   * agency name or an outlook word further along the string. "AAA STABLE BY
   * IND" filed as D is the case that matters — the safest grade there is,
   * shown as a default.
   */
  it('is not fooled by an agency name or an outlook after the grade', () => {
    expect(ratingGrade('AAA STABLE BY IND')).toBe('AAA');       // was 'D'
    expect(ratingGrade('AA BY CRISIL')).toBe('AA');             // was 'C'
    expect(ratingGrade('AAA by CRISIL & ICRA')).toBe('AAA');    // was 'A'
    expect(ratingGrade('BBB+ BY CARE')).toBe('BBB');            // was 'CA'
    expect(ratingGrade('BBB+ BY ICRA')).toBe('BBB');            // was 'A'
    expect(ratingGrade('AA BY ACUITE & IVR')).toBe('AA');       // was 'AC'
    expect(ratingGrade('CRISIL AAA/Stable')).toBe('AAA');       // was 'AB'
  });

  it('ignores a credit-enhancement marker', () => {
    expect(ratingGrade('CARE BB+ (CE)')).toBe('BB');
    expect(ratingGrade('A+ (CE) by Crisil & IND Ratings')).toBe('A');
  });

  it('takes the last grade when two agencies disagree', () => {
    expect(ratingGrade('CARE A, BWR AA-')).toBe('AA');
    expect(ratingGrade('CRISIL BBB+ , BWR BBB & ACUITE C')).toBe('C');
  });

  it('never returns something that is not a grade', () => {
    // "SOVERIGN" (sic) is in the master and is not a credit grade.
    expect(ratingGrade('SOVERIGN')).toBeNull();
    expect(ratingGrade('Unrated')).toBeNull();
    expect(ratingGrade('A1+')).toBeNull(); // a short-term rating, not on this scale
  });

  it('normalises the many spellings of a payout frequency', () => {
    expect(payoutOf(bond({ coupon_frequency: 'semi_annual' }))).toBe('Semi-annual');
    expect(payoutOf(bond({ coupon_frequency: 'half-yearly' }))).toBe('Semi-annual');
    expect(payoutOf(bond({ coupon_frequency: 'ANNUALLY' }))).toBe('Annual');
    expect(payoutOf(bond({ coupon_frequency: 'at maturity' }))).toBe('At maturity');
  });

  it('leaves an unrecognised frequency readable rather than dropping it', () => {
    expect(payoutOf(bond({ coupon_frequency: 'every_two_years' }))).toBe('Every two years');
  });

  it('returns empty, not a placeholder, for missing text fields', () => {
    expect(payoutOf(bond({ coupon_frequency: null }))).toBe('');
    expect(taxOf(bond({ tax_status: null }))).toBe('');
    expect(collateralOf(bond({ security_type: '  ' }))).toBe('');
  });
});

describe('range membership', () => {
  it('is inclusive at the bottom of a band and exclusive at the top', () => {
    expect(passYield(8, ['8_10'])).toBe(true);
    expect(passYield(10, ['8_10'])).toBe(false);
    expect(passYield(10, ['10_12'])).toBe(true);
  });

  it('puts everything at or above 12% in the top band', () => {
    expect(passYield(12, ['gt12'])).toBe(true);
    expect(passYield(40, ['gt12'])).toBe(true);
  });

  it('ORs the bands within a category', () => {
    expect(passYield(9, ['lt8', '8_10'])).toBe(true);
  });

  it('passes everything when nothing is selected', () => {
    expect(passYield(null, [])).toBe(true);
    expect(passTenure(null, [])).toBe(true);
    expect(passMinInv(null, [])).toBe(true);
  });

  it('excludes a bond whose value is unknown once a band IS selected', () => {
    // A filtered list must not include rows that might not belong.
    expect(passYield(null, ['8_10'])).toBe(false);
    expect(passTenure(null, ['1_3'])).toBe(false);
    expect(passMinInv(null, ['lt1l'])).toBe(false);
  });

  it('places exactly ₹1 L in the "up to ₹1 L" band, not the next one', () => {
    expect(passMinInv(100000, ['lt1l'])).toBe(true);
    expect(passMinInv(100000, ['1_3l'])).toBe(false);
    expect(passMinInv(100001, ['1_3l'])).toBe(true);
  });

  it('bands tenure at whole years', () => {
    expect(passTenure(0.99, ['lt1'])).toBe(true);
    expect(passTenure(1, ['lt1'])).toBe(false);
    expect(passTenure(1, ['1_3'])).toBe(true);
    expect(passTenure(5, ['gt5'])).toBe(true);
  });
});

describe('matchesFilters', () => {
  it('passes everything through an empty filter', () => {
    expect(matchesFilters(bond(), EMPTY_FILTERS)).toBe(true);
  });

  it('ANDs across categories', () => {
    const b = bond({ analytics: { ytm: 9, years_to_maturity: 2 } });
    expect(matchesFilters(b, filters({ yield: ['8_10'], tenure: ['1_3'] }))).toBe(true);
    // Right yield, wrong tenure — one failure is enough.
    expect(matchesFilters(b, filters({ yield: ['8_10'], tenure: ['gt5'] }))).toBe(false);
  });

  it('matches a rating on its grade, not on the full string', () => {
    const b = bond({ rating: 'CRISIL AA-' });
    expect(matchesFilters(b, filters({ rating: ['AA'] }))).toBe(true);
    expect(matchesFilters(b, filters({ rating: ['AAA'] }))).toBe(false);
  });

  it('shows a AAA bond to someone filtering for AAA, however it is written', () => {
    // Previously this bond's grade parsed as 'D' and it appeared under nothing.
    const b = bond({ rating: 'AAA STABLE BY IND' });
    expect(matchesFilters(b, filters({ rating: ['AAA'] }))).toBe(true);
    expect(matchesFilters(b, filters({ rating: ['D'] }))).toBe(false);
  });

  it('excludes an unrated bond once a rating is selected', () => {
    expect(matchesFilters(bond({ rating: null }), filters({ rating: ['AAA'] }))).toBe(false);
  });

  it('matches payout on the normalised label', () => {
    const b = bond({ coupon_frequency: 'semi_annual' });
    expect(matchesFilters(b, filters({ payout: ['Semi-annual'] }))).toBe(true);
    expect(matchesFilters(b, filters({ payout: ['Monthly'] }))).toBe(false);
  });

  it('matches tax and collateral on their raw values', () => {
    const b = bond({ tax_status: 'taxable', security_type: 'secured' });
    expect(matchesFilters(b, filters({ tax: ['taxable'], collateral: ['secured'] }))).toBe(true);
    expect(matchesFilters(b, filters({ collateral: ['unsecured'] }))).toBe(false);
  });
});

describe('selection state', () => {
  it('counts every selected option across categories', () => {
    expect(countFilters(filters({ yield: ['lt8', '8_10'], rating: ['AAA'] }))).toBe(3);
    expect(countFilters(EMPTY_FILTERS)).toBe(0);
  });

  it('toggles an option on and back off without mutating the input', () => {
    const before = EMPTY_FILTERS;
    const on = toggleFilter(before, 'yield', 'lt8');
    expect(on.yield).toEqual(['lt8']);
    expect(before.yield).toEqual([]);
    expect(toggleFilter(on, 'yield', 'lt8').yield).toEqual([]);
  });

  it('removes one option and leaves its siblings', () => {
    const f = removeFilter(filters({ yield: ['lt8', '8_10'] }), 'yield', 'lt8');
    expect(f.yield).toEqual(['8_10']);
  });

  it('labels a range chip with its band, not its key', () => {
    const chips = filterChips(filters({ yield: ['8_10'], minInv: ['1_3l'] }));
    expect(chips.map((c) => c.label)).toEqual(['8 – 10%', '₹1 – 3 L']);
  });

  it('title-cases a tax or collateral chip and leaves a rating alone', () => {
    const chips = filterChips(filters({ rating: ['AAA'], tax: ['taxable'] }));
    expect(chips.find((c) => c.cat === 'rating')?.label).toBe('AAA');
    expect(chips.find((c) => c.cat === 'tax')?.label).toBe('Taxable');
  });

  it('keeps a chip removable by returning the category it came from', () => {
    const [chip] = filterChips(filters({ collateral: ['secured'] }));
    expect(removeFilter(filters({ collateral: ['secured'] }), chip.cat, chip.k).collateral).toEqual([]);
  });
});

describe('filterCategories', () => {
  const offered = [
    bond({ rating: 'CARE AA-', coupon_frequency: 'monthly', tax_status: 'taxable', security_type: 'secured' }),
    bond({ rating: 'CRISIL AAA', coupon_frequency: 'annual', tax_status: 'tax-free', security_type: 'unsecured' }),
    bond({ rating: 'IND AA+', coupon_frequency: 'monthly', tax_status: 'taxable', security_type: 'secured' }),
  ];

  it('always offers the three fixed ranges in full', () => {
    const cats = filterCategories([]);
    expect(cats.find((c) => c.key === 'yield')?.opts).toHaveLength(4);
    expect(cats.find((c) => c.key === 'tenure')?.opts).toHaveLength(4);
    expect(cats.find((c) => c.key === 'minInv')?.opts).toHaveLength(4);
  });

  it('offers no bucket that no offered bond falls into', () => {
    const cats = filterCategories(offered);
    expect(cats.find((c) => c.key === 'rating')?.opts.map((o) => o.k)).toEqual(['AAA', 'AA']);
    expect(cats.find((c) => c.key === 'collateral')?.opts.map((o) => o.k)).toEqual(['secured', 'unsecured']);
  });

  it('orders ratings by credit quality, not alphabetically', () => {
    // Alphabetical would put AA above AAA, which reads as the safer bond first.
    const opts = filterCategories(offered).find((c) => c.key === 'rating')!.opts;
    expect(opts.map((o) => o.k)).toEqual(['AAA', 'AA']);
  });

  it('deduplicates a value shared by several bonds', () => {
    const opts = filterCategories(offered).find((c) => c.key === 'payout')!.opts;
    expect(opts.map((o) => o.k)).toEqual(['Annual', 'Monthly']);
  });

  it('leaves a category empty rather than inventing options', () => {
    const cats = filterCategories([bond({ rating: null, tax_status: null })]);
    expect(cats.find((c) => c.key === 'rating')?.opts).toEqual([]);
    expect(cats.find((c) => c.key === 'tax')?.opts).toEqual([]);
  });

  it('every derived option actually matches at least one offered bond', () => {
    // The guarantee the whole derivation exists for: no dead bucket.
    for (const cat of filterCategories(offered)) {
      if (cat.key === 'yield' || cat.key === 'tenure' || cat.key === 'minInv') continue;
      for (const opt of cat.opts) {
        const f = filters({ [cat.key]: [opt.k] } as Partial<BondFilters>);
        expect(offered.some((b) => matchesFilters(b, f))).toBe(true);
      }
    }
  });
});
