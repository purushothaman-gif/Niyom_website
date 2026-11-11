import { describe, expect, it } from 'vitest';
import { dayToIso, isoToDay, parseAmfiHistory, seriesToNavPoints, todayIst, windowEndingAt, WINDOW_DAYS } from './amfiNavSeries.ts';

describe('amfiNavSeries', () => {
  it('converts dates to day numbers and back', () => {
    expect(isoToDay('1970-01-01')).toBe(0);
    expect(dayToIso(isoToDay('2026-11-09'))).toBe('2026-11-09');
    expect(dayToIso(isoToDay('2024-02-29') + 1)).toBe('2024-03-01');
  });

  it('uses the Indian date just after midnight IST', () => {
    expect(todayIst(Date.parse('2026-11-11T19:00:00Z'))).toBe('2026-11-12');
    expect(todayIst(Date.parse('2026-11-11T18:00:00Z'))).toBe('2026-11-11');
  });

  it('walks backwards in windows that never overlap', () => {
    const a = windowEndingAt(null, '2026-11-12');
    expect(a.to).toBe('2026-11-12');
    expect(isoToDay(a.to) - isoToDay(a.from)).toBe(WINDOW_DAYS - 1);
    const b = windowEndingAt(dayToIso(isoToDay(a.from) - 1));
    expect(isoToDay(b.to)).toBe(isoToDay(a.from) - 1);
  });

  it('parses AMFI history: sorted, one per day, bad rows dropped', () => {
    const s = parseAmfiHistory({
      data: {
        nav_groups: [
          {
            nav_name: 'X Fund - Growth',
            historical_records: [
              { date: '2026-11-05', nav: 226.142 },
              { date: '2026-11-03', nav: '224.5' },
              { date: '2026-11-04', nav: 0 },
              { date: 'garbage', nav: 10 },
              { date: '2026-11-03T00:00:00.000Z', nav: 999 },
            ],
          },
        ],
      },
    });
    expect(s.d.map(dayToIso)).toEqual(['2026-11-03', '2026-11-05']);
    expect(s.n).toEqual([224.5, 226.142]);
    expect(parseAmfiHistory({ message: 'No records to display' })).toEqual({ d: [], n: [] });
    expect(parseAmfiHistory(null)).toEqual({ d: [], n: [] });
  });

  it('hands the returns maths newest-first dd-mm-yyyy points', () => {
    const pts = seriesToNavPoints({ d: [isoToDay('2026-11-03'), isoToDay('2026-11-05')], n: [224.5, 226.142] });
    expect(pts).toEqual([
      { date: '05-11-2026', nav: '226.142' },
      { date: '03-11-2026', nav: '224.5' },
    ]);
  });
});
