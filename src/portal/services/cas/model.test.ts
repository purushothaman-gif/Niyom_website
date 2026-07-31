/**
 * CAS domain logic.
 *
 * These cover the decisions that are wrong in ways that LOOK FINE on screen —
 * a doubled net worth, a redemption counted as income, a debt fund shown as
 * equity, a stale statement presented as current. None of them throw, so
 * without tests the only signal is a client noticing their own money is wrong.
 */
import { describe, expect, it } from 'vitest';
import type { NWHolding } from '../../../crm/types';
import type { PortalHolding } from '../../types/cas';
import { MF_OWNERSHIP, ownershipOf } from '../../types/ownership';
import {
  assessCasFreshness,
  isOpenPosition,
  migrationCandidates,
  selectHoldings,
  toFlow,
  toHolding,
  type CasSchemeRow,
} from './model';

/* ------------------------------------------------------------------ fixtures */

const holding = (o: Partial<PortalHolding>): PortalHolding =>
  ({
    id: Math.random().toString(36).slice(2),
    client_id: 'client-1',
    product_type: 'mutual_fund',
    product_name: 'A Fund',
    quantity: 10,
    avg_cost: 8,
    current_value: 100,
    invested_amount: 80,
    maturity_date: '',
    notes: '',
    created_at: '',
    updated_at: '',
    ...o,
  }) as PortalHolding;

const scheme = (o: Partial<CasSchemeRow> = {}): CasSchemeRow => ({
  id: 'scheme-1',
  name: 'Kotak ELSS Tax Saver Fund - Direct Plan - Growth (Non-Demat)',
  units: 351.147,
  nav: 139.209,
  nav_date: '2026-07-31',
  value: 48882.82,
  cost: 45500,
  isin: 'INF174K01LI3',
  rta: 'CAMS',
  rta_code: 'K144D',
  advisor_code: 'INZ000208032',
  is_ours: false,
  cas_folios: { folio_number: '12924960', amc: 'Kotak Mutual Fund', registrar: 'CAMS' },
  ...o,
});

const ctx = {
  clientId: 'client-1',
  importId: 'import-1',
  importedAt: '2026-08-01T00:00:00Z',
  statementTo: '2026-08-01',
};

/* -------------------------------------------------- source selection (MF) -- */

describe('selectHoldings — which source wins', () => {
  const manualMf = holding({ product_name: 'Kotak ELSS (our record)', current_value: 48882 });
  const bond = holding({ product_type: 'secondary_bond', product_name: 'A Bond', current_value: 100000 });
  const insurance = holding({ product_type: 'insurance', product_name: 'A Policy', current_value: 50000 });
  const fd = holding({ product_type: 'fixed_deposit', product_name: 'An FD', current_value: 25000 });
  const unlisted = holding({ product_type: 'unlisted_share', product_name: 'Some Shares', current_value: 30000 });
  const manual = [manualMf, bond, insurance, fd, unlisted];

  const casHoldings = [
    holding({ product_name: 'Kotak ELSS (statement)', current_value: 48882 }),
    holding({ product_name: 'quant ELSS', current_value: 84596 }),
  ];

  it('REPLACES manual mutual funds rather than adding to them', () => {
    const merged = selectHoldings(manual, casHoldings);
    const mf = merged.filter((h) => h.product_type === 'mutual_fund');
    expect(mf).toHaveLength(2);
    expect(mf.reduce((s, h) => s + h.current_value, 0)).toBe(48882 + 84596);
    expect(mf.map((h) => h.product_name)).not.toContain('Kotak ELSS (our record)');
  });

  it('does not double-count a fund present in both sources', () => {
    // The same fund is in nw_holdings AND the statement. Concatenating would
    // report 182,360 of mutual funds where the client holds 133,478.
    const total = selectHoldings(manual, casHoldings).reduce((s, h) => s + h.current_value, 0);
    const expected = 48882 + 84596 + 100000 + 50000 + 25000 + 30000;
    expect(total).toBe(expected);
  });

  it('keeps every non-mutual-fund asset class from nw_holdings', () => {
    const merged = selectHoldings(manual, casHoldings);
    const kinds = merged.filter((h) => h.product_type !== 'mutual_fund').map((h) => h.product_type);
    expect(kinds.sort()).toEqual(['fixed_deposit', 'insurance', 'secondary_bond', 'unlisted_share']);
  });

  it('leaves everything alone when no statement has been imported', () => {
    expect(selectHoldings(manual, null)).toEqual(manual);
  });

  it('still drops manual mutual funds when the statement holds none', () => {
    // An imported statement with zero open fund positions is a real answer:
    // the client has exited everything. Falling back to our stale rows would
    // resurrect holdings the statement says are gone.
    const merged = selectHoldings(manual, []);
    expect(merged.every((h) => h.product_type !== 'mutual_fund')).toBe(true);
    expect(merged).toHaveLength(4);
  });

  it('sorts by value, largest first', () => {
    const merged = selectHoldings(manual, casHoldings);
    const values = merged.map((h) => h.current_value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});

/* ------------------------------------------------------------- cash flows -- */

describe('toFlow — cash flow signs from the investor’s side', () => {
  const flow = (txn_type: string, amount: number, units = 0) =>
    toFlow({ txn_date: '2024-01-01', txn_type, amount, units });

  it('treats a purchase as money out', () => {
    expect(flow('PURCHASE', 5000)?.amount).toBe(-5000);
  });

  it('treats a redemption as money in, whatever sign the statement printed', () => {
    // A CAS parenthesises redemptions, so the stored amount is already negative.
    expect(flow('REDEMPTION', -19053.54)?.amount).toBe(19053.54);
  });

  it('treats a dividend PAYOUT as money in', () => {
    expect(flow('DIVIDEND', 903.9, 0)?.amount).toBe(903.9);
  });

  it('ignores a dividend that was REINVESTED', () => {
    // Units means the money stayed in the fund — no cash reached the investor,
    // and counting it would inflate the return.
    expect(flow('DIVIDEND', 903.9, 12.5)).toBeNull();
  });

  it('excludes both legs of a switch as an internal transfer', () => {
    expect(flow('SWITCH_OUT', -5000)).toBeNull();
    expect(flow('SWITCH_IN', 5000)).toBeNull();
  });

  it('treats STT and stamp duty as money out', () => {
    expect(flow('STT', 0.19)?.amount).toBe(-0.19);
    expect(flow('STAMP_DUTY', 0.02)?.amount).toBe(-0.02);
  });

  it('ignores rows that move no money and rows with no date', () => {
    expect(flow('PURCHASE', 0)).toBeNull();
    expect(toFlow({ txn_date: '', txn_type: 'PURCHASE', amount: 5000, units: 0 })).toBeNull();
    expect(flow('OTHER', 100)).toBeNull();
  });
});

/* --------------------------------------------------------------- ownership -- */

describe('ownershipOf — held with us, held away, or unknown', () => {
  it('is held-with-Niyom when the statement names our ARN', () => {
    expect(ownershipOf('ARN-362707', true)).toBe(MF_OWNERSHIP.heldWithNiyom);
  });

  it('is held-away when the statement names a different distributor', () => {
    expect(ownershipOf('ARN-163992', false)).toBe(MF_OWNERSHIP.heldAway);
    expect(ownershipOf('INZ000208032', false)).toBe(MF_OWNERSHIP.heldAway);
  });

  it('is UNKNOWN when no advisor code was stated, not held-away', () => {
    // A summary CAS carries no advisor code at all. Calling that "held away"
    // would label an entire portfolio on no evidence, and would put folios that
    // may already be ours in front of a future migration wizard.
    expect(ownershipOf(null, false)).toBe(MF_OWNERSHIP.unknown);
    expect(ownershipOf('', false)).toBe(MF_OWNERSHIP.unknown);
    expect(ownershipOf('   ', false)).toBe(MF_OWNERSHIP.unknown);
  });

  it('carries the ownership decision onto the mapped holding', () => {
    const ours = toHolding(scheme({ advisor_code: 'ARN-362707', is_ours: true }), ctx);
    expect(ours.cas?.ownership).toBe(MF_OWNERSHIP.heldWithNiyom);
    expect(toHolding(scheme(), ctx).cas?.ownership).toBe(MF_OWNERSHIP.heldAway);
    expect(toHolding(scheme({ advisor_code: null }), ctx).cas?.ownership).toBe(MF_OWNERSHIP.unknown);
  });
});

/* ---------------------------------------------------------------- mapping -- */

describe('toHolding — statement row to portal holding', () => {
  const h = toHolding(scheme(), ctx);

  it('maps money and units onto the shared holding shape', () => {
    expect(h.product_type).toBe('mutual_fund');
    expect(h.current_value).toBe(48882.82);
    expect(h.invested_amount).toBe(45500);
    expect(h.quantity).toBe(351.147);
    expect(h.avg_cost).toBeCloseTo(45500 / 351.147, 6);
  });

  it('carries every field an ARN migration will need', () => {
    expect(h.cas).toMatchObject({
      source: 'cas',
      importId: 'import-1',
      importedAt: ctx.importedAt,
      statementTo: '2026-08-01',
      schemeId: 'scheme-1',
      isin: 'INF174K01LI3',
      rtaCode: 'K144D',
      amc: 'Kotak Mutual Fund',
      folioNumber: '12924960',
      registrar: 'CAMS',
      advisorCode: 'INZ000208032',
      isOurs: false,
    });
    expect(h.cas?.units).toBe(351.147);
    expect(h.cas?.schemeName).toContain('Kotak ELSS');
  });

  it('leaves scheme_type empty so the name classifier can act', () => {
    // A CAS never states a category; inventing one here would be worse than
    // letting assetClassOf read the scheme name.
    expect(h.scheme_type).toBeUndefined();
  });

  it('guards against a zero-unit holding when averaging cost', () => {
    expect(toHolding(scheme({ units: 0, cost: 0, value: 0 }), ctx).avg_cost).toBe(0);
  });

  it('falls back to the folio registrar when the scheme row has none', () => {
    expect(toHolding(scheme({ rta: null }), ctx).cas?.registrar).toBe('CAMS');
  });
});

describe('isOpenPosition', () => {
  it('keeps a holding with value', () => {
    expect(isOpenPosition(scheme())).toBe(true);
  });

  it('drops a fully exited fund from the holdings list', () => {
    // Exited funds stay in the statement because they carry realised gains, but
    // they are not something the client still holds.
    expect(isOpenPosition(scheme({ value: 0, units: 0 }))).toBe(false);
  });

  it('keeps units with no value, which is a valuation gap rather than an exit', () => {
    expect(isOpenPosition(scheme({ value: 0, units: 12.5 }))).toBe(true);
  });
});

/* --------------------------------------------------------------- staleness -- */

describe('assessCasFreshness', () => {
  it('reports none when nothing has been imported', () => {
    expect(assessCasFreshness(null, '2026-08-05').state).toBe('none');
  });

  it('is current when we have recorded nothing since the statement', () => {
    expect(assessCasFreshness('2026-08-01', null).state).toBe('current');
    expect(assessCasFreshness('2026-08-01', '2026-07-20').state).toBe('current');
  });

  it('is current when our latest transaction is ON the statement date', () => {
    // The statement covers that day, so it is already included.
    expect(assessCasFreshness('2026-08-01', '2026-08-01').state).toBe('current');
  });

  it('is stale once we have recorded a fund transaction after the statement', () => {
    const f = assessCasFreshness('2026-08-01', '2026-08-05');
    expect(f.state).toBe('stale');
    expect(f.statementTo).toBe('2026-08-01');
    expect(f.latestOwnMfTxnDate).toBe('2026-08-05');
  });

  it('compares dates, not timestamps', () => {
    // A timestamped transaction on the statement date must not read as newer
    // just because it carries a time component.
    expect(assessCasFreshness('2026-08-01', '2026-08-01T18:30:00Z').state).toBe('current');
  });
});

/* --------------------------------------------------------------- migration -- */

describe('migrationCandidates', () => {
  const heldAway = toHolding(scheme({ id: 'a', advisor_code: 'ARN-163992', is_ours: false }), ctx);
  const ours = toHolding(scheme({ id: 'b', advisor_code: 'ARN-362707', is_ours: true }), ctx);
  const unknown = toHolding(scheme({ id: 'c', advisor_code: null, is_ours: false }), ctx);
  const bond = holding({ product_type: 'secondary_bond' });

  it('returns held-away folios only', () => {
    const out = migrationCandidates([heldAway, ours, unknown, bond]);
    expect(out.map((c) => c.schemeId)).toEqual(['a']);
  });

  it('never offers a folio whose distributor was never stated', () => {
    expect(migrationCandidates([unknown])).toHaveLength(0);
  });

  it('gives the wizard what it needs without re-reading the statement', () => {
    const [c] = migrationCandidates([heldAway]);
    expect(c.folioNumber).toBe('12924960');
    expect(c.isin).toBe('INF174K01LI3');
    expect(c.advisorCode).toBe('ARN-163992');
    expect(c.registrar).toBe('CAMS');
    expect(c.importId).toBe('import-1');
  });
});

/* ------------------------------------------------------ backward compatibility */

describe('backward compatibility', () => {
  it('accepts plain NWHolding rows that predate the cas block', () => {
    const legacy: NWHolding = holding({ product_type: 'secondary_bond' });
    expect(() => selectHoldings([legacy], null)).not.toThrow();
    expect(selectHoldings([legacy], null)[0].cas).toBeUndefined();
  });
});
