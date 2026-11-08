import { describe, expect, it } from 'vitest';
import { fetchRtaTransactions, mergeByDateDesc, RTA_TXN_LABEL } from './rtaMf';
import type { NiyomDb } from '../platform/db';

/** Minimal stand-in for the query builder fetchRtaTransactions uses. */
function fakeDb(rows: Record<string, unknown>[]): NiyomDb {
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
    then: (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve(res({ data: rows, error: null })),
  };
  return { from: () => q } as unknown as NiyomDb;
}

describe('registrar transactions in the portal', () => {
  it('maps kinds to buy/sell with a client-facing label, ids prefixed rta-', async () => {
    const out = await fetchRtaTransactions(fakeDb([
      { id: 'a', scheme_name: 'Quant Small Cap', scheme_code: 'X', folio: '1', txn_kind: 'sip', amount: -4999.75, units: 18.2, nav: 274.7, trade_date: '2026-10-05' },
      { id: 'b', scheme_name: null, scheme_code: 'Y', folio: '2', txn_kind: 'redemption', amount: 1000, units: -3, nav: 333, trade_date: null, post_date: '2026-10-06' },
      { id: 'c', scheme_name: 'Z', scheme_code: 'Z', folio: '3', txn_kind: 'switch_in', amount: 500, units: 5, nav: 100, trade_date: null, post_date: null },
    ]), 'client-1');
    expect(out).toHaveLength(2); // the undated row is dropped
    expect(out[0]).toMatchObject({ id: 'rta-a', txn_type: 'buy', notes: 'SIP', consolidated_amount: 4999.75, quantity: 18.2, product_type: 'mutual_fund' });
    expect(out[1]).toMatchObject({ id: 'rta-b', txn_type: 'sell', notes: 'Redemption', product_name: 'Y', txn_date: '2026-10-06', quantity: 3 });
  });

  it('only buy/sell kinds are listed (dividends/other are not cash in or out)', () => {
    expect(Object.keys(RTA_TXN_LABEL).sort()).toEqual(['purchase', 'redemption', 'sip', 'switch_in', 'switch_out']);
  });

  it('merges two newest-first lists into one, capped', () => {
    const a = [{ txn_date: '2026-11-05' }, { txn_date: '2026-09-01' }];
    const b = [{ txn_date: '2026-10-10' }];
    expect(mergeByDateDesc(a, b, 2).map((t) => t.txn_date)).toEqual(['2026-11-05', '2026-10-10']);
  });
});
