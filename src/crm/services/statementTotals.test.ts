import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {}, clientSupabase: {} }));

import type { CasCrmView } from './casClientView';
import type { DematCrmView } from './dematClientView';
import { statementTotals } from './statementTotals';

const cas = (schemes: { value: number; cost: number; ownership: string }[]) =>
  ({ schemes } as unknown as CasCrmView);
const demat = (groups: { key: string; label: string; value: number }[]) =>
  ({ groups } as unknown as DematCrmView);

describe('statementTotals', () => {
  it('adds nothing when there are no statements', () => {
    expect(statementTotals(null, null, 15046)).toEqual({ value: 0, invested: 0, heldElsewhere: 0, slices: [] });
  });

  it('counts funds outside Niyom at their own cost', () => {
    const t = statementTotals(cas([{ value: 1200, cost: 1000, ownership: 'held_away' }, { value: 300, cost: 250, ownership: 'unknown' }]), null, 0);
    expect(t.value).toBe(1500);
    expect(t.invested).toBe(1250);
    expect(t.heldElsewhere).toBe(1500);
  });

  it('skips our-ARN statement funds when the registrar feed already has them', () => {
    const c = cas([{ value: 500, cost: 400, ownership: 'held_with_niyom' }, { value: 100, cost: 90, ownership: 'held_away' }]);
    expect(statementTotals(c, null, 480).value).toBe(100);
    const noFeed = statementTotals(c, null, 0);
    expect(noFeed.value).toBe(600);
    expect(noFeed.heldElsewhere).toBe(100);
  });

  it('enters demat holdings at value and drops demat MFs when a CAS exists', () => {
    const d = demat([{ key: 'equity', label: 'Stocks', value: 2000 }, { key: 'demat_mf', label: 'Mutual Funds (demat)', value: 700 }]);
    const withCas = statementTotals(cas([]), d, 0);
    expect(withCas.value).toBe(2000);
    expect(withCas.invested).toBe(2000);
    const alone = statementTotals(null, d, 0);
    expect(alone.value).toBe(2700);
    expect(alone.slices.map((s) => s.label)).toEqual(['Stocks (demat)', 'Mutual Funds (demat)']);
  });
});
