import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {}, clientSupabase: {} }));

import type { CasCrmView } from './casClientView';
import type { DematCrmView } from './dematClientView';
import { statementTotals } from './statementTotals';

const cas = (schemes: { value: number; cost: number; ownership: string }[]) =>
  ({ schemes } as unknown as CasCrmView);
const demat = (groups: { key: string; label: string; value: number; holdings?: object[] }[]) =>
  ({ groups: groups.map((g) => ({ ...g, holdings: g.holdings ?? [{ isin: null, value: g.value }] })) } as unknown as DematCrmView);

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

  it('does not count a holding a second time when another source already has it', () => {
    // A bond we sold also sits in the client's demat account.
    const d = demat([{ key: 'corporate_bond', label: 'Corporate Bonds', value: 3000, holdings: [{ isin: 'INE111A07011', value: 1000 }, { isin: 'INE222B07022', value: 2000 }] }]);
    expect(statementTotals(null, d, 0, { bookIsins: ['ine111a07011'] }).value).toBe(2000);

    // A fund that moved to us after the statement date: same folio in the feed.
    const c = cas([{ value: 1300, cost: 1000, ownership: 'held_away', folioNumber: '3426 8297/74', isin: 'INF1' } as never, { value: 400, cost: 300, ownership: 'held_away', folioNumber: '999', isin: 'INF2' } as never]);
    expect(statementTotals(c, null, 1310, { registrar: [{ folio: '34268297/74', isin: 'INF1' }] }).value).toBe(400);
  });
});
