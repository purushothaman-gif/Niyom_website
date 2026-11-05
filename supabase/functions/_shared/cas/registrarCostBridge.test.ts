/**
 * The registrar-cost bridge decides which registrar holding, if any, a detailed
 * CAS scheme's cost of acquisition belongs to. Writing a wrong cost is worse
 * than writing none, so these pin the "never guess" rule: it writes only on a
 * confident, unambiguous match and skips everything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sbSelect = vi.fn();
const sbPatch = vi.fn();
vi.mock('./db.ts', () => ({
  sbSelect: (...a: unknown[]) => sbSelect(...a),
  sbPatch: (...a: unknown[]) => sbPatch(...a),
}));

import { bridgeRegistrarCost } from './registrarCostBridge.ts';
import type { CasDetailedScheme } from './detailed.ts';

const cfg = { supabaseUrl: 'http://x', supabaseServiceRoleKey: 'k' };

const scheme = (over: Partial<CasDetailedScheme>): CasDetailedScheme => ({
  amc: '', folioNumber: '', rtaCode: '', schemeName: '', isin: '', advisorCode: '',
  registrar: 'CAMS', isDemat: false, openingUnits: 0, closingUnits: 0, costValue: 0,
  nav: 0, navDate: '', marketValue: 0, transactions: [], balanceMismatch: null,
  ...over,
});

type Holding = { id: string; folio: string; scheme_code: string | null; units: number };
function wire(holdings: Holding[], folios: { id: string }[] = [{ id: 'f1' }]) {
  sbSelect.mockImplementation((_c: unknown, path: string) => {
    if (path.startsWith('mf_rta_folios')) return Promise.resolve(folios);
    if (path.startsWith('mf_rta_holdings')) return Promise.resolve(holdings);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  sbSelect.mockReset();
  sbPatch.mockReset();
});

describe('bridgeRegistrarCost', () => {
  it('writes cost onto the one holding of a single-scheme folio (the SANKAR case)', async () => {
    wire([{ id: 'h1', folio: '20625018', scheme_code: 'PP001RG', units: 36.771 }]);
    const r = await bridgeRegistrarCost(
      cfg, 'c1',
      [scheme({ folioNumber: '20625018', rtaCode: 'PP001RG', closingUnits: 36.771, costValue: 3000 })],
      '2026-11-05',
    );
    expect(r).toEqual({ matched: 1, skipped: 0 });
    expect(sbPatch).toHaveBeenCalledWith(cfg, 'mf_rta_holdings?id=eq.h1', {
      invested_cost: 3000, cost_date: '2026-11-05',
    });
  });

  it('matches the right scheme in a multi-scheme folio by RTA product code', async () => {
    wire([
      { id: 'hA', folio: 'F1', scheme_code: 'AAA', units: 10 },
      { id: 'hB', folio: 'F1', scheme_code: 'BBB', units: 20 },
    ]);
    const r = await bridgeRegistrarCost(
      cfg, 'c1',
      [scheme({ folioNumber: 'F1', rtaCode: 'BBB', closingUnits: 20, costValue: 999 })],
      '2026-11-05',
    );
    expect(r.matched).toBe(1);
    expect(sbPatch).toHaveBeenCalledOnce();
    expect(sbPatch).toHaveBeenCalledWith(cfg, 'mf_rta_holdings?id=eq.hB', expect.objectContaining({ invested_cost: 999 }));
  });

  it('normalises folio spacing and check digits', async () => {
    wire([{ id: 'h1', folio: '34268297 / 74', scheme_code: 'H02', units: 60.832 }]);
    const r = await bridgeRegistrarCost(
      cfg, 'c1',
      [scheme({ folioNumber: '34268297/74', rtaCode: 'H02', closingUnits: 60.832, costValue: 120000 })],
      '2026-11-05',
    );
    expect(r.matched).toBe(1);
  });

  it('skips an ambiguous multi-scheme folio it cannot disambiguate', async () => {
    wire([
      { id: 'hA', folio: 'F1', scheme_code: 'AAA', units: 10 },
      { id: 'hB', folio: 'F1', scheme_code: 'BBB', units: 20 },
    ]);
    // No matching rta code and units match neither holding.
    const r = await bridgeRegistrarCost(
      cfg, 'c1',
      [scheme({ folioNumber: 'F1', rtaCode: 'ZZZ', closingUnits: 99, costValue: 500 })],
      '2026-11-05',
    );
    expect(r).toEqual({ matched: 0, skipped: 1 });
    expect(sbPatch).not.toHaveBeenCalled();
  });

  it('never writes a zero or negative cost', async () => {
    wire([{ id: 'h1', folio: 'F1', scheme_code: 'X', units: 5 }]);
    const r = await bridgeRegistrarCost(
      cfg, 'c1',
      [
        scheme({ folioNumber: 'F1', rtaCode: 'X', closingUnits: 5, costValue: 0 }),
        scheme({ folioNumber: 'F1', rtaCode: 'X', closingUnits: 5, costValue: -10 }),
      ],
      '2026-11-05',
    );
    expect(r.matched).toBe(0);
    expect(sbPatch).not.toHaveBeenCalled();
  });

  it('does nothing when the client has no registrar folios', async () => {
    wire([{ id: 'h1', folio: 'F1', scheme_code: 'X', units: 5 }], []);
    const r = await bridgeRegistrarCost(
      cfg, 'c1',
      [scheme({ folioNumber: 'F1', rtaCode: 'X', closingUnits: 5, costValue: 100 })],
      '2026-11-05',
    );
    expect(r.matched).toBe(0);
    expect(sbPatch).not.toHaveBeenCalled();
  });

  it('skips a lone-holding folio when the units are wildly off (stale/mismatched)', async () => {
    wire([{ id: 'h1', folio: 'F1', scheme_code: 'X', units: 36 }]);
    const r = await bridgeRegistrarCost(
      cfg, 'c1',
      [scheme({ folioNumber: 'F1', rtaCode: '', closingUnits: 5, costValue: 100 })],
      '2026-11-05',
    );
    expect(r).toEqual({ matched: 0, skipped: 1 });
    expect(sbPatch).not.toHaveBeenCalled();
  });

  it('defaults cost_date to today when the statement has none', async () => {
    wire([{ id: 'h1', folio: 'F1', scheme_code: 'X', units: 5 }]);
    await bridgeRegistrarCost(
      cfg, 'c1',
      [scheme({ folioNumber: 'F1', rtaCode: 'X', closingUnits: 5, costValue: 100 })],
      null,
    );
    const patch = sbPatch.mock.calls[0][2] as { cost_date: string };
    expect(patch.cost_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
