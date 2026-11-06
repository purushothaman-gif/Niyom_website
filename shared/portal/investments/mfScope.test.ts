import { describe, expect, it } from 'vitest';
import { applyMfScope, isHeldAwayMf } from './mfScope';

const rows = [
  { id: 'bond', product_type: 'bond', cas: null },
  { id: 'rta', product_type: 'mutual_fund' }, // registrar feed: ours, no CAS meta
  { id: 'cas-ours', product_type: 'mutual_fund', cas: { isOurs: true } },
  { id: 'cas-away', product_type: 'mutual_fund', cas: { isOurs: false } },
  { id: 'cas-unstated', product_type: 'mutual_fund', cas: { isOurs: null } },
];

describe('mutual fund scope', () => {
  it('All keeps the whole book', () => {
    expect(applyMfScope(rows, 'all').map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('Through Niyom drops only held-away funds', () => {
    expect(applyMfScope(rows, 'niyom').map((r) => r.id)).toEqual(['bond', 'rta', 'cas-ours']);
  });

  it('a non-MF row is never held away', () => {
    expect(isHeldAwayMf({ product_type: 'bond', cas: { isOurs: false } })).toBe(false);
  });
});
