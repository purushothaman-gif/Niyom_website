/**
 * The partner's spread on unlisted shares.
 *
 * Same reasoning as partnerBondMath.test.ts: this decides what a partner's
 * client is quoted and what the partner earns, across the order modal, the
 * shareable link and the two server functions that re-derive it. The cases are
 * mostly boundaries — an empty field, a margin over the cap, a price on a
 * rounding edge — because that is where the bond version's hand-written copies
 * had already drifted apart before they were consolidated.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_PARTNER_SHARE_MARGIN,
  clampShareMargin,
  isShareMarginValid,
  partnerSharePrice,
  partnerShareBreakdown,
} from './partnerShareMath';

const share = (base: number | null) => ({ partner_base: base });

describe('clampShareMargin', () => {
  it('holds the 5% cap', () => {
    expect(MAX_PARTNER_SHARE_MARGIN).toBe(5);
    expect(clampShareMargin(9)).toBe(5);
    expect(clampShareMargin('100')).toBe(5);
  });

  it('floors a negative margin at zero — a partner cannot sell below cost', () => {
    expect(clampShareMargin(-2)).toBe(0);
  });

  it('treats an empty or unparseable field as zero, not NaN', () => {
    // A margin field the user has cleared should price at cost, not poison
    // every figure on the screen with NaN.
    expect(clampShareMargin('')).toBe(0);
    expect(clampShareMargin(null)).toBe(0);
    expect(clampShareMargin(undefined)).toBe(0);
    expect(clampShareMargin('abc')).toBe(0);
  });
});

describe('isShareMarginValid', () => {
  it('rejects an unanswered field but accepts a deliberate zero', () => {
    expect(isShareMarginValid('')).toBe(false);
    expect(isShareMarginValid('0')).toBe(true);
    expect(isShareMarginValid(0)).toBe(true);
  });

  it('rejects anything outside 0–5', () => {
    expect(isShareMarginValid(5)).toBe(true);
    expect(isShareMarginValid(5.01)).toBe(false);
    expect(isShareMarginValid(-0.01)).toBe(false);
  });
});

describe('partnerSharePrice', () => {
  it('adds the spread to cost and rounds to paise', () => {
    expect(partnerSharePrice(share(1000), 2.5)).toBe(1025);
    expect(partnerSharePrice(share(1234.5), 3)).toBe(1271.54); // 1271.535 → 1271.54
  });

  it('prices at cost when the margin is zero or blank', () => {
    expect(partnerSharePrice(share(1234.5), 0)).toBe(1234.5);
    expect(partnerSharePrice(share(1234.5), '')).toBe(1234.5);
  });

  it('never quotes above cost + 5%, whatever is passed in', () => {
    expect(partnerSharePrice(share(1000), 50)).toBe(1050);
  });
});

describe('partnerShareBreakdown', () => {
  it('reports the amount and what the spread earns on the lot', () => {
    const bd = partnerShareBreakdown(share(1000), 10, 2.5);
    expect(bd.pricePerShare).toBe(1025);
    expect(bd.amount).toBe(10250);
    expect(bd.yourMargin).toBe(250);
  });

  it('earns nothing at a zero margin', () => {
    const bd = partnerShareBreakdown(share(1000), 10, 0);
    expect(bd.amount).toBe(10000);
    expect(bd.yourMargin).toBe(0);
  });

  it('derives the amount from the ROUNDED per-share price', () => {
    // The server snapshots price_per_share at 2dp and computes qty × that, so
    // the screen has to round the price first too. Multiplying by the unrounded
    // 1271.535 would show 127153.50 against the server's 127154.00.
    const bd = partnerShareBreakdown(share(1234.5), 100, 3);
    expect(bd.pricePerShare).toBe(1271.54);
    expect(bd.amount).toBe(127154);
  });

  it('does not produce NaN when the cost is missing', () => {
    const bd = partnerShareBreakdown(share(null), 10, 2.5);
    expect(bd.amount).toBe(0);
    expect(bd.yourMargin).toBe(0);
  });
});
