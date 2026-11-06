import { describe, it, expect } from 'vitest';
import { parseYahooChart } from './marketWatch';

const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }], error: null } });

describe('parseYahooChart', () => {
  it('uses fulldayChange, not chartPreviousClose, for the day move', () => {
    const q = parseYahooChart(
      chart({
        regularMarketPrice: 25030.35,
        fulldayChange: 493.75,
        fulldayChangePercent: 2.012,
        chartPreviousClose: 23960.6,
        regularMarketTime: 1793959282,
      }),
    );
    expect(q.price).toBe(25030.35);
    expect(q.change).toBe(493.75);
    expect(q.prevClose).toBe(24536.6);
    expect(q.changePct).toBe(2.012);
    expect(q.asOf).toBe(new Date(1793959282 * 1000).toISOString());
  });

  it('derives the change from the percent when no absolute change is given', () => {
    const q = parseYahooChart(chart({ regularMarketPrice: 110, regularMarketChangePercent: 10 }));
    expect(q.change).toBe(10);
    expect(q.prevClose).toBe(100);
  });

  it('leaves change unknown rather than guessing from chartPreviousClose', () => {
    const q = parseYahooChart(chart({ regularMarketPrice: 50, chartPreviousClose: 40 }));
    expect(q.change).toBeNull();
    expect(q.changePct).toBeNull();
    expect(q.asOf).toBeNull();
  });

  it('throws on an error body or a missing price', () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { code: 'Not Found', description: 'delisted' } } })).toThrow('delisted');
    expect(() => parseYahooChart(chart({}))).toThrow();
  });
});
