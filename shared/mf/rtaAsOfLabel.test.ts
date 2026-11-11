import { describe, expect, it } from 'vitest';
import { rtaAsOfLabel } from './rtaMf';

const fmt = (iso: string) => `<${iso}>`;

describe('rtaAsOfLabel', () => {
  it('names both dates when the feed and the NAV differ', () =>
    expect(rtaAsOfLabel({ snapshotDate: '2026-11-10', navDate: '2026-11-09' }, fmt)).toBe(
      'units as of <2026-11-10> · NAV <2026-11-09>',
    ));
  it('uses one date when they agree or only one is known', () => {
    expect(rtaAsOfLabel({ snapshotDate: '2026-11-09', navDate: '2026-11-09' }, fmt)).toBe('as of <2026-11-09>');
    expect(rtaAsOfLabel({ snapshotDate: '2026-11-06', navDate: null }, fmt)).toBe('as of <2026-11-06>');
    expect(rtaAsOfLabel({ snapshotDate: null, navDate: null }, fmt)).toBeNull();
  });
});
