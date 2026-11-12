import { describe, expect, it } from 'vitest';
import { computeElssLockIn, isElssName, type ElssLockIn } from './elssLockIn';
import type { SchemeGains, OpenLot } from './gains';

const NOW = new Date('2026-11-12T00:00:00Z');

function scheme(partial: Partial<SchemeGains> & { schemeName: string; openLots: OpenLot[] }): SchemeGains {
  const openUnits = partial.openLots.reduce((s, l) => s + l.units, 0);
  const openCost = partial.openLots.reduce((s, l) => s + l.cost, 0);
  return {
    schemeId: partial.schemeId ?? 's1',
    schemeName: partial.schemeName,
    isin: partial.isin ?? 'INF000ELSS01',
    assetClass: partial.assetClass ?? 'equity',
    complete: partial.complete ?? true,
    incompleteReason: partial.incompleteReason,
    disposals: partial.disposals ?? [],
    openLots: partial.openLots,
    openCost: partial.openCost ?? openCost,
    openUnits: partial.openUnits ?? openUnits,
    unrealised: partial.unrealised ?? null,
  };
}

function lot(buyDate: string, units: number, cost: number): OpenLot {
  return { buyDate, units, buyNav: cost / units, cost };
}

describe('isElssName', () => {
  it('matches the usual ELSS brandings', () => {
    expect(isElssName('SBI Long Term Equity Fund - Direct - Growth')).toBe(true);
    expect(isElssName('Mirae Asset ELSS Tax Saver Fund')).toBe(true);
    expect(isElssName('Quant Tax Plan Tax-Saving - Growth')).toBe(true);
  });
  it('does not match ordinary equity funds', () => {
    expect(isElssName('Parag Parikh Flexi Cap Fund')).toBe(false);
    expect(isElssName('HDFC Liquid Fund')).toBe(false);
    expect(isElssName(null)).toBe(false);
  });
});

describe('computeElssLockIn', () => {
  it('returns null when there are no ELSS lots', () => {
    const r = computeElssLockIn([scheme({ schemeName: 'Parag Parikh Flexi Cap', openLots: [lot('2024-01-01', 10, 1000)] })], NOW);
    expect(r).toBeNull();
  });

  it('splits lots into locked and free by the 3-year boundary', () => {
    const r = computeElssLockIn(
      [
        scheme({
          schemeName: 'Axis Long Term Equity Fund',
          openLots: [
            lot('2021-06-01', 100, 10_000), // > 3y ago → free
            lot('2025-06-01', 50, 8_000), // < 3y ago → locked
          ],
        }),
      ],
      NOW,
    ) as ElssLockIn;
    expect(r).not.toBeNull();
    expect(r.lots).toHaveLength(2);
    expect(r.freeInvested).toBe(10_000);
    expect(r.lockedInvested).toBe(8_000);
    expect(r.totalInvested).toBe(18_000);
    expect(r.lockedUnits).toBe(50);
    expect(r.freeUnits).toBe(100);
    expect(r.nextUnlockDate).toBe('2028-06-01');
    // Locked lot sorts first.
    expect(r.lots[0].locked).toBe(true);
    expect(r.lots[0].daysToUnlock).toBeGreaterThan(0);
    expect(r.lots[1].locked).toBe(false);
    expect(r.lots[1].daysToUnlock).toBe(0);
  });

  it('treats a lot exactly 3 years old as free', () => {
    const r = computeElssLockIn(
      [scheme({ schemeName: 'ELSS Tax Saver', openLots: [lot('2023-11-12', 10, 1000)] })],
      NOW,
    ) as ElssLockIn;
    expect(r.lots[0].locked).toBe(false);
    expect(r.lots[0].unlockDate).toBe('2026-11-12');
  });

  it('derives current value from the scheme unrealised figure', () => {
    const r = computeElssLockIn(
      [
        scheme({
          schemeName: 'ELSS Fund',
          openLots: [lot('2025-01-01', 100, 10_000)],
          unrealised: 2_000, // value = cost + unrealised = 12,000
        }),
      ],
      NOW,
    ) as ElssLockIn;
    expect(r.currentValue).toBe(12_000);
    expect(r.lots[0].currentValue).toBe(12_000);
  });

  it('leaves current value null when no NAV is known', () => {
    const r = computeElssLockIn(
      [scheme({ schemeName: 'ELSS Fund', openLots: [lot('2025-01-01', 100, 10_000)], unrealised: null })],
      NOW,
    ) as ElssLockIn;
    expect(r.currentValue).toBeNull();
    expect(r.lots[0].currentValue).toBeNull();
  });

  it('skips incomplete schemes', () => {
    const r = computeElssLockIn(
      [scheme({ schemeName: 'Axis Long Term Equity', complete: false, openLots: [lot('2025-01-01', 10, 1000)] })],
      NOW,
    );
    expect(r).toBeNull();
  });
});
