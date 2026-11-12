import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { buildDematGroups, type DematHoldingRow } from './dematClientView';

const row = (over: Partial<DematHoldingRow>): DematHoldingRow => ({
  id: Math.random().toString(36).slice(2),
  asset_class: 'equity',
  isin: 'INE000A01001',
  name: 'Stock',
  units: 10,
  value: 1000,
  demat_accounts: { depository: 'CDSL', dp_name: 'Broker', bo_id: '1234567890123456' },
  ...over,
});

describe('buildDematGroups', () => {
  it('groups by class in display order, largest holding first', () => {
    const groups = buildDematGroups([
      row({ asset_class: 'demat_mf', name: 'Fund', value: 500 }),
      row({ name: 'Small', value: 100 }),
      row({ name: 'Big', value: 900 }),
      row({ asset_class: 'gsec', name: 'GOI 2033', value: 300 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['equity', 'gsec', 'demat_mf']);
    expect(groups[0].holdings.map((h) => h.name)).toEqual(['Big', 'Small']);
    expect(groups[0].value).toBe(1000);
  });

  it('drops zero lines and derives a price from value and units', () => {
    const groups = buildDematGroups([
      row({ name: 'Closed', units: 0, value: 0 }),
      row({ name: 'Held', units: 4, value: 100 }),
    ]);
    expect(groups[0].holdings).toHaveLength(1);
    expect(groups[0].holdings[0].price).toBe(25);
  });

  it('puts an unrecognised class under Other rather than losing it', () => {
    const groups = buildDematGroups([row({ asset_class: 'sgb', name: 'Gold Bond' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('other');
  });

  it('tolerates a holding with no account row', () => {
    const [g] = buildDematGroups([row({ demat_accounts: null })]);
    expect(g.holdings[0].depository).toBeNull();
  });
});
