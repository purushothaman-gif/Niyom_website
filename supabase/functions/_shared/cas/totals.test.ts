/**
 * The portfolio total is the only check that can notice a scheme was never
 * parsed at all. Every per-scheme check compares a block against itself, so a
 * block that was never read has nothing to disagree with.
 *
 * It was blind: the pattern demanded the two amounts be fused with no space,
 * which is how the summary CAS prints them and NOT how the detailed one does.
 * A real import was therefore accepted as "reconciled" while ten schemes and
 * ₹13.9L of a ₹54.8L portfolio were missing — the client noticed, not us.
 */
import { describe, expect, it } from 'vitest';
import { readStatedTotalPair, readStatedTotals } from './parse.ts';

describe('reading the statement’s own grand total', () => {
  it('reads the fused form the summary CAS prints', () => {
    expect(readStatedTotalPair(['Total 216,883.66194,580.90'])).toEqual([216883.66, 194580.9]);
  });

  it('reads the space-separated form the detailed CAS prints', () => {
    // Verbatim from the statement that slipped through.
    expect(readStatedTotalPair(['Total 3,071,559.36 5,481,720.24'])).toEqual([3071559.36, 5481720.24]);
  });

  it('is null when the statement prints no total', () => {
    // Callers must treat this as unreconcilable, never as agreement.
    expect(readStatedTotalPair(['Closing Unit Balance: 1.000 Total Cost Value: 10.00'])).toBeNull();
    expect(readStatedTotals(['nothing here'])).toBeNull();
  });

  it('does not mistake a scheme’s cost line for the portfolio total', () => {
    expect(readStatedTotalPair(['Closing Unit Balance: 364.650 Total Cost Value: 24,785.26'])).toBeNull();
  });
});

describe('which column is which', () => {
  /*
   * The two variants disagree: the summary prints market then cost, the detailed
   * one cost then market. reconcileDetailed decides by fit rather than by
   * position — see the note on readStatedTotalPair — so both orders reconcile
   * and neither produces a false failure.
   */
  it('returns the pair in printed order, leaving the caller to orient it', () => {
    const [a, b] = readStatedTotalPair(['Total 3,071,559.36 5,481,720.24'])!;
    expect(a).toBeLessThan(b); // cost first in this layout
  });
});
