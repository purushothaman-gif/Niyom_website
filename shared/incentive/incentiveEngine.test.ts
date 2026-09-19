import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG_V1, computeIncentive, nextGoals, parseIncentiveConfig, effectiveConfig,
  mergeVolumes, payrollMonthFor, periodKey,
} from './incentiveEngine';

const config = DEFAULT_CONFIG_V1;
// The workbook's own inputs: MF 10L, SIP 25k, Bond/FD 50L — 3 min + 3 OA products.
const WORKBOOK_VOLUMES = { mf: 1_000_000, sip: 25_000, bond_fd: 5_000_000, unlisted: 0, insurance: 0 };
const run = (revenue: number, volumes: Record<string, number> = WORKBOOK_VOLUMES, salary = 40_000) =>
  computeIncentive({ config, salary, revenue, volumes });

describe('computeIncentive — workbook parity', () => {
  it('reproduces the workbook golden case (X=22 → capped ₹4,40,000)', () => {
    const r = run(880_000);
    expect(r.x).toBe(22);
    expect(r.band.label).toBe('Above 20x');
    expect(r.eligible).toBe(true);
    expect(r.productsMet).toBe(3);
    expect(r.oaMet).toBe(3);
    expect(r.base).toBe(180_000);
    expect(r.addon).toBe(220_000);
    expect(r.oaBonus).toBe(88_000);
    expect(r.cap).toBe(440_000);
    expect(r.capped).toBe(true);
    expect(r.final).toBe(440_000);
  });

  it('X=6: 5.5x band, add-on and OA, under the cap', () => {
    const r = run(240_000);
    expect(r.band.lower_x).toBe(5.5);
    expect([r.base, r.addon, r.oaBonus]).toEqual([64_000, 19_200, 18_000]);
    expect(r.final).toBe(101_200);
    expect(r.capped).toBe(false);
  });

  it('X=9.5: 9x band', () => {
    const r = run(380_000);
    expect([r.base, r.addon, r.oaBonus]).toEqual([96_000, 34_200, 28_500]);
    expect(r.final).toBe(158_700);
  });

  it('X=12: 12x band hits the 50% cap', () => {
    const r = run(480_000);
    expect(r.gross).toBe(250_400);
    expect(r.final).toBe(240_000);
    expect(r.capped).toBe(true);
  });

  it('X exactly 5.5 pays no add-on (strictly above)', () => {
    const r = run(220_000);
    expect(r.band.lower_x).toBe(5.5);
    expect(r.addonActive).toBe(false);
    expect(r.addon).toBe(0);
    expect(r.final).toBe(64_000 + 16_500);
  });

  it('band boundaries pick the band that starts at X', () => {
    for (const b of config.bands) {
      expect(run(b.lower_x * 40_000).band.lower_x).toBe(b.lower_x);
    }
  });
});

describe('computeIncentive — eligibility', () => {
  it('below 2x pays nothing', () => {
    const r = run(79_999);
    expect(r.eligible).toBe(false);
    expect(r.final).toBe(0);
  });

  it('below 10x needs 3 products at minimum threshold', () => {
    const r = run(240_000, { mf: 100_000, sip: 3_000, bond_fd: 0, unlisted: 0, insurance: 0 });
    expect(r.productsRequired).toBe(3);
    expect(r.productsMet).toBe(2);
    expect(r.eligible).toBe(false);
    expect(r.final).toBe(0);
  });

  it('at 10x or more one product is enough', () => {
    const r = run(400_000, { mf: 100_000 });
    expect(r.productsRequired).toBe(1);
    expect(r.eligible).toBe(true);
    // No OA products → no OA bonus.
    expect(r.oaBonus).toBe(0);
    expect(r.final).toBe(96_000 + 36_000);
  });

  it('no salary structure: no division by zero, nothing payable', () => {
    const r = run(500_000, WORKBOOK_VOLUMES, 0);
    expect(r.hasSalary).toBe(false);
    expect(r.x).toBe(0);
    expect(r.final).toBe(0);
    expect(nextGoals({ config, salary: 0, revenue: 500_000, volumes: WORKBOOK_VOLUMES }).nextBand).toBeNull();
  });
});

describe('nextGoals', () => {
  it('names the revenue to the next band and projects the incentive there', () => {
    const g = nextGoals({ config, salary: 40_000, revenue: 240_000, volumes: WORKBOOK_VOLUMES });
    expect(g.nextBand?.band.lower_x).toBe(7);
    expect(g.nextBand?.targetRevenue).toBe(280_000);
    expect(g.nextBand?.gap).toBe(40_000);
    expect(g.nextBand?.projectedIncentive).toBe(
      computeIncentive({ config, salary: 40_000, revenue: 280_000, volumes: WORKBOOK_VOLUMES }).final,
    );
  });

  it('suggests the cheapest missing products for eligibility', () => {
    const g = nextGoals({ config, salary: 40_000, revenue: 240_000, volumes: { mf: 100_000, sip: 2_000, insurance: 20_000 } });
    expect(g.eligibility?.needed).toBe(2);
    expect(g.eligibility?.suggestions.map(s => s.key)).toEqual(['sip', 'insurance']);
    expect(g.eligibility?.suggestions[0].shortfall).toBe(1_000);
  });

  it('shows the add-on unlock one rupee over 5.5x', () => {
    const g = nextGoals({ config, salary: 40_000, revenue: 200_000, volumes: WORKBOOK_VOLUMES });
    expect(g.addonUnlock?.targetRevenue).toBe(220_001);
  });

  it('top band has no next band', () => {
    expect(nextGoals({ config, salary: 40_000, revenue: 880_000, volumes: WORKBOOK_VOLUMES }).nextBand).toBeNull();
  });
});

describe('config + helpers', () => {
  it('the default config parses', () => {
    expect(parseIncentiveConfig(JSON.parse(JSON.stringify(config))).ok).toBe(true);
  });

  it('rejects unsorted bands and a bad cap', () => {
    const bad = JSON.parse(JSON.stringify(config));
    bad.bands[3].lower_x = 1;
    bad.rules.cap_pct_revenue = 0;
    const p = parseIncentiveConfig(bad);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('manual volumes override auto, blanks do not', () => {
    expect(mergeVolumes({ mf: 5, sip: 0 }, { sip: 3000, mf: '' as unknown as number })).toEqual({ mf: 5, sip: 3000 });
  });

  it('August revenue is paid in September; December rolls the year', () => {
    expect(payrollMonthFor(periodKey(2026, 7))).toEqual({ year: 2026, month0: 8 });
    expect(payrollMonthFor('2026-12-01')).toEqual({ year: 2027, month0: 0 });
  });
});

describe('multi-product mandate switch', () => {
  const oneProduct = { mf: 100_000 };

  it('ON (default): 6x with one product is not eligible', () => {
    const r = computeIncentive({ config, salary: 40_000, revenue: 240_000, volumes: oneProduct });
    expect(r.eligible).toBe(false);
  });

  it('OFF for the month: revenue alone decides; OA still needs its products', () => {
    const off = effectiveConfig(config, false);
    const r = computeIncentive({ config: off, salary: 40_000, revenue: 240_000, volumes: oneProduct });
    expect(r.productsRequired).toBe(0);
    expect(r.eligible).toBe(true);
    expect(r.oaBonus).toBe(0);
    expect(r.final).toBe(64_000 + 19_200);
    expect(nextGoals({ config: off, salary: 40_000, revenue: 240_000, volumes: oneProduct }).eligibility).toBeNull();
  });

  it('OFF still requires the minimum X', () => {
    const r = computeIncentive({ config: effectiveConfig(config, false), salary: 40_000, revenue: 60_000, volumes: {} });
    expect(r.eligible).toBe(false);
  });

  it('null override keeps the structure setting; old versions without the key parse as ON', () => {
    expect(effectiveConfig(config, null)).toBe(config);
    const old = JSON.parse(JSON.stringify(config));
    delete old.rules.product_mandate;
    const p = parseIncentiveConfig(old);
    expect(p.ok && p.config.rules.product_mandate).toBe(true);
  });
});
