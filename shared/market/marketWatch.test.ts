import { describe, it, expect } from 'vitest';
import {
  commoditiesFromRows,
  fmtAsOfDate,
  fmtAsOfTime,
  fmtSigned,
  fmtSignedPct,
  rowToQuote,
  tickerItems,
  toneOfChange,
} from './marketWatch';

describe('commoditiesFromRows', () => {
  it('takes the latest day and changes against the previous stored day', () => {
    const out = commoditiesFromRows([
      { commodity: 'gold', price: '134988', price_date: '2026-11-05' },
      { commodity: 'gold', price: '139574', price_date: '2026-11-06' },
      { commodity: 'silver', price: 204080, price_date: '2026-11-06' },
    ]);
    expect(out).toHaveLength(2);
    const gold = out[0];
    expect(gold.commodity).toBe('gold');
    expect(gold.price).toBe(139574);
    expect(gold.change).toBe(4586);
    expect(gold.changePct).toBeCloseTo(3.397, 2);
    expect(gold.asOfDate).toBe('2026-11-06');
    // A single day has no change rather than a fake 0.
    expect(out[1].change).toBeNull();
  });

  it('omits a commodity with no rows', () => {
    expect(commoditiesFromRows([])).toEqual([]);
  });
});

describe('rowToQuote', () => {
  it('parses PostgREST numeric strings and keeps nulls', () => {
    const q = rowToQuote({
      symbol: 'NIFTY50', label: 'NIFTY 50', kind: 'index',
      price: '25030.35', change: '493.75', change_pct: '2.012', prev_close: null,
      as_of: '2026-11-06T10:01:22Z', source: 'yahoo',
    });
    expect(q.price).toBe(25030.35);
    expect(q.changePct).toBe(2.012);
    expect(q.prevClose).toBeNull();
  });
});

describe('formatting', () => {
  it('signs changes with a true minus and treats zero as flat', () => {
    expect(fmtSignedPct(2.012)).toBe('+2.01%');
    expect(fmtSignedPct(-0.6034)).toBe('−0.60%');
    expect(fmtSignedPct(0.001)).toBe('0.00%');
    expect(fmtSignedPct(null)).toBe('—');
    expect(fmtSigned(1718.016)).toBe('+1,718.02');
    expect(toneOfChange(-0.1)).toBe('down');
    expect(toneOfChange(0)).toBe('flat');
    expect(toneOfChange(null)).toBe('flat');
  });

  it('stamps times in IST and dates without a timezone shift', () => {
    // 10:01 UTC = 3:31 pm IST
    expect(fmtAsOfTime('2026-11-06T10:01:22Z')).toBe('6 Nov, 3:31 pm');
    expect(fmtAsOfTime(null)).toBe('—');
    expect(fmtAsOfDate('2026-11-05')).toBe('5 Nov 2026');
    expect(fmtAsOfDate('bad')).toBe('—');
  });
});

describe('tickerItems', () => {
  it('lists NIFTY, SENSEX, then metals, skipping unpriced quotes', () => {
    const quotes = [
      rowToQuote({ symbol: 'SENSEX', label: 'SENSEX', kind: 'index', price: '81028.02', change_pct: '2.166', as_of: '2026-11-06T10:02:33Z' }),
      rowToQuote({ symbol: 'NIFTY50', label: 'NIFTY 50', kind: 'index', price: null, change_pct: null, as_of: null }),
    ];
    const metals = commoditiesFromRows([{ commodity: 'gold', price: 139574, price_date: '2026-11-06' }]);
    const items = tickerItems(quotes, metals);
    expect(items.map((i) => i.key)).toEqual(['SENSEX', 'gold']);
    expect(items[0].value).toBe('81,028.02');
    expect(items[0].asOf).toBe('6 Nov, 3:32 pm');
    expect(items[1]).toMatchObject({ label: 'Gold 10g', value: '₹1,39,574', asOf: '6 Nov 2026' });
  });
});
