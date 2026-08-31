/**
 * The unlisted-share quantity rule and order amount.
 *
 * The quantity rule is enforced in two places that must never disagree — the
 * stepper on the detail page and `place-share-order` on the server. When they
 * drift, the UI happily accepts a quantity the server then rejects, and the
 * client sees an error on a screen that told them the number was fine. These
 * cases pin the boundaries: the minimum itself, one below it, and a value that
 * is above the minimum but off the lot step.
 */
import { describe, it, expect } from 'vitest';
import { minQty, stepQty, isValidQty, shareBreakdown } from './shareMath';

describe('quantity rules', () => {
  it('defaults a missing or nonsensical rule to 1', () => {
    expect(minQty({ min_qty: null, lot_size: null })).toBe(1);
    expect(stepQty({ min_qty: null, lot_size: null })).toBe(1);
    // A zero or negative lot would make every quantity invalid (or divide by
    // zero in the modulo); it floors to 1 rather than bricking the share.
    expect(minQty({ min_qty: 0, lot_size: 0 })).toBe(1);
    expect(stepQty({ min_qty: 0, lot_size: -5 })).toBe(1);
  });

  it('accepts the minimum and rejects one below it', () => {
    const share = { min_qty: 25, lot_size: 5 };
    expect(isValidQty(share, 25)).toBe(true);
    expect(isValidQty(share, 24)).toBe(false);
    expect(isValidQty(share, 0)).toBe(false);
    expect(isValidQty(share, -5)).toBe(false);
  });

  it('steps from the minimum, not from zero', () => {
    // The trap: 30 is divisible by 5 but is not min + n·step (25 + 5n gives
    // 25, 30, 35 — so 30 IS valid here), while 27 sits between two lots.
    const share = { min_qty: 25, lot_size: 5 };
    expect(isValidQty(share, 30)).toBe(true);
    expect(isValidQty(share, 27)).toBe(false);

    // With a minimum that is not itself a multiple of the step, stepping from
    // zero would be wrong: 20 is a multiple of 10 but below/off the ladder.
    const odd = { min_qty: 15, lot_size: 10 };
    expect(isValidQty(odd, 15)).toBe(true);
    expect(isValidQty(odd, 25)).toBe(true);
    expect(isValidQty(odd, 20)).toBe(false);
  });

  it('rejects fractional quantities — shares are whole units', () => {
    expect(isValidQty({ min_qty: 1, lot_size: 1 }, 1.5)).toBe(false);
  });
});

describe('shareBreakdown', () => {
  it('multiplies quantity by price and rounds to paise', () => {
    expect(shareBreakdown(1234.5, 3).amount).toBe(3703.5);
    expect(shareBreakdown(1234.56, 7)).toEqual({
      qty: 7,
      pricePerShare: 1234.56,
      amount: 8641.92,
    });
  });

  it('rounds a half-paise result up rather than leaving float noise', () => {
    // 3 × 10.005 = 30.014999… in binary floating point; the epsilon nudge is
    // what keeps this at 30.02 instead of 30.01.
    expect(shareBreakdown(10.005, 3).amount).toBe(30.02);
  });

  it('treats a missing price as zero rather than producing NaN', () => {
    // An unpriced share should never reach this screen, but a NaN would spread
    // into every figure on it if one did.
    expect(shareBreakdown(null, 5).amount).toBe(0);
  });
});
