/**
 * The reconciliation gate decides whether a client's portfolio is allowed in.
 *
 * It has to stay strict — a dropped transaction shows the wrong money — while
 * not refusing statements that are correct but unusual. The segregated-portfolio
 * case below is the second kind, and it blocked a real import on 04-Aug-2026.
 */
import { describe, expect, it } from 'vitest';
import { reconcileDetailed, rowsFromHoldings, rowsFromSchemes } from './reconcile.ts';
import type { CasDetailedScheme } from './detailed.ts';

const scheme = (over: Partial<CasDetailedScheme> = {}): CasDetailedScheme => ({
  amc: 'Nippon India Mutual Fund',
  folioNumber: '405144928343/0',
  rtaCode: '',
  schemeName: 'NIPPON INDIA LIQUID FUND - GROWTH PLAN',
  isin: '',
  advisorCode: '',
  registrar: 'KFINTECH',
  isDemat: false,
  openingUnits: 0,
  closingUnits: 0,
  costValue: 0,
  nav: 10,
  navDate: '2026-08-04',
  marketValue: 0,
  transactions: [],
  balanceMismatch: null,
  ...over,
});

const txn = (units: number, type = 'PURCHASE') => ({
  date: '2026-01-01',
  description: 'Purchase',
  amount: units * 10,
  units,
  nav: 10,
  balanceUnits: units,
  type,
});

describe('reconcileDetailed — segregated portfolios', () => {
  /*
   * When an issuer defaults, the AMC side-pockets the doubtful paper and
   * credits holders with units of a "Segregated Portfolio". Nobody bought them,
   * so the statement prints no transaction — and the unit checks read that as a
   * whole block of dropped ones.
   */
  it('accepts side-pocketed units that have no transactions', () => {
    const result = reconcileDetailed(
      [
        scheme({
          schemeName: 'NIPPON INDIA MEDIUM DURATION FUND - SEGREGATED PORTFOLIO 2 - GROWTH PLAN',
          closingUnits: 4768.581,
          transactions: [],
        }),
      ],
      [],
    );
    expect(result.failures).toEqual([]);
    expect(result.reconciled).toBe(true);
    // Passed, but not silently.
    expect(result.warnings.join(' ')).toContain('segregated portfolio');
  });

  it('still fails an ORDINARY scheme whose transactions are missing', () => {
    // The exemption must not become a way for a dropped block to slip through.
    const result = reconcileDetailed(
      [scheme({ closingUnits: 4768.581, transactions: [] })],
      [],
    );
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.reconciled).toBe(false);
  });

  it('still checks a segregated portfolio that DOES carry transactions', () => {
    // If the statement prints a ledger for it, that ledger has to add up.
    const result = reconcileDetailed(
      [
        scheme({
          schemeName: 'ABC DEBT FUND - SEGREGATED PORTFOLIO 1',
          closingUnits: 100,
          transactions: [txn(40)],
        }),
      ],
      [],
    );
    expect(result.failures.length).toBeGreaterThan(0);
  });
});

describe('reconcileDetailed — the checks that must keep firing', () => {
  it('passes a scheme whose ledger adds up', () => {
    const result = reconcileDetailed(
      [scheme({ closingUnits: 40, transactions: [txn(40)] })],
      [],
    );
    expect(result.failures).toEqual([]);
  });

  it('fails a unit-bearing transaction it could not name', () => {
    const result = reconcileDetailed(
      [
        scheme({
          closingUnits: 40,
          transactions: [{ ...txn(40), type: 'OTHER', description: 'Registration of Nominee' }],
        }),
      ],
      [],
    );
    expect(result.failures.join(' ')).toContain('could not be identified');
  });
});

describe('reconcileDetailed — rounding in the portfolio total', () => {
  /*
   * Every scheme's value is printed rounded to the paisa, so adding N of them
   * lands a few paise from the total the registrar printed once. A real
   * statement was refused over ₹0.02 across six schemes — and told the client
   * "a scheme was probably missed entirely", which was wrong and alarming.
   */
  const withTotal = (values: number[], statedMarket: number, statedCost: number) => {
    const schemes = values.map((v, i) =>
      scheme({
        folioNumber: `F${i}`,
        schemeName: `Fund ${i}`,
        closingUnits: 10,
        marketValue: v,
        costValue: v,
        nav: v / 10,
        transactions: [txn(10)],
      }),
    );
    return reconcileDetailed(schemes, [`Total ${statedCost.toFixed(2)} ${statedMarket.toFixed(2)}`]);
  };

  it('accepts a few paise of rounding across several schemes', () => {
    // 6 schemes summing to 282443.51 against a printed 282443.49.
    const values = [50000.25, 60000.13, 40000.51, 70000.22, 42442.4, 20000.0];
    const sum = values.reduce((a, b) => a + b, 0);
    const result = withTotal(values, sum - 0.02, sum - 0.02);
    expect(result.failures).toEqual([]);
    expect(result.reconciled).toBe(true);
  });

  it('still refuses a genuinely missing scheme', () => {
    // One ₹50,000 holding absent is nothing like a rounding difference.
    const values = [50000.25, 60000.13];
    const sum = values.reduce((a, b) => a + b, 0);
    const result = withTotal(values, sum + 50000, sum + 50000);
    expect(result.failures.join(' ')).toContain('probably missed entirely');
    expect(result.reconciled).toBe(false);
  });

  it('keeps a single-scheme statement at one paisa', () => {
    const result = withTotal([1000.0], 1000.5, 1000.5);
    expect(result.reconciled).toBe(false);
  });
});

/* ------------------------------------------------------------ row builders -- */

describe('turning a parse into database rows', () => {
  /*
   * These had NO coverage, and that is exactly how the first real import
   * through the Edge Function failed.
   *
   * Extracting this module from the droplet's import.ts dropped its
   * `node:crypto` import along with the express ones, leaving `randomUUID`
   * undefined in three places here. Nothing caught it. `supabase/` is in no
   * tsconfig, so there is no typecheck; the tests that came across covered
   * `reconcileDetailed` and nothing else; and the builders run BEFORE the first
   * insert, so every import died with a generic 500 and no row to show for it.
   *
   * A test that merely calls them would have caught it, which is the whole
   * point of the ones below.
   */
  const scheme = (over: Partial<CasDetailedScheme> = {}): CasDetailedScheme => ({
    amc: 'Sundaram Mutual Fund',
    folioNumber: '61015022015 / 0',
    rtaCode: '176SBDP',
    schemeName: 'SUNDARAM AGGRESSIVE HYBRID FUND - REGULAR PLAN',
    isin: 'INF173K01CI4',
    advisorCode: 'ARN-362707',
    registrar: 'CAMS',
    isDemat: false,
    openingUnits: 0,
    closingUnits: 7135.212,
    costValue: 200000,
    nav: 25.08,
    navDate: '2026-08-03',
    marketValue: 178970.38,
    transactions: [
      {
        date: '2020-08-04', description: 'Purchase', type: 'PURCHASE',
        amount: 199990, units: 7135.212, nav: 28.03847, balanceUnits: 7135.212,
      },
      {
        date: '2020-08-04', description: '*** Stamp Duty ***', type: 'STAMP_DUTY',
        amount: 10, units: 0, nav: 0, balanceUnits: 7135.212,
      },
    ],
    balanceMismatch: null,
    ...over,
  });

  it('builds folio, scheme and transaction rows', () => {
    const rows = rowsFromSchemes([scheme()], 'import-1', 'client-1');

    expect(rows.folios).toHaveLength(1);
    expect(rows.schemes).toHaveLength(1);
    expect(rows.transactions).toHaveLength(2);
  });

  it('gives every row a real id and links children to their parent', () => {
    // The ids are generated up front so children can reference parents without
    // waiting for the insert to come back — if id generation is broken, nothing
    // downstream works.
    const rows = rowsFromSchemes([scheme()], 'import-1', 'client-1');
    const folio = rows.folios[0] as { id: string };
    const s = rows.schemes[0] as { id: string; folio_id: string; advisor_code: string };

    expect(folio.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(s.folio_id).toBe(folio.id);
    expect(s.advisor_code).toBe('ARN-362707');

    for (const t of rows.transactions as { scheme_id: string; import_id: string }[]) {
      expect(t.scheme_id).toBe(s.id);
      expect(t.import_id).toBe('import-1');
    }
  });

  it('gives two schemes different ids', () => {
    const rows = rowsFromSchemes([scheme(), scheme({ isin: 'INF209K01BR9' })], 'i', 'c');
    const [a, b] = rows.schemes as { id: string }[];
    expect(a.id).not.toBe(b.id);
  });

  it('drops an undated transaction rather than failing the insert', () => {
    // txn_date is NOT NULL; one unusable row must not take the import with it.
    const rows = rowsFromSchemes(
      [scheme({ transactions: [{ date: '', description: 'x', type: 'PURCHASE', amount: 1, units: 1, nav: 1, balanceUnits: 1 }] })],
      'i',
      'c',
    );
    expect(rows.transactions).toHaveLength(0);
    expect(rows.schemes).toHaveLength(1);
  });

  it('builds rows from a summary parse too', () => {
    const rows = rowsFromHoldings(
      [
        {
          folioNumber: '123', amc: 'X', registrar: 'CAMS', rtaCode: 'R1',
          schemeName: 'A Fund', isin: 'INF173K01CI4', units: 10, nav: 20,
          navDate: '2026-08-03', marketValue: 200, costValue: 150,
        } as never,
      ],
      'import-1',
      'client-1',
    );
    expect(rows.folios).toHaveLength(1);
    expect(rows.schemes).toHaveLength(1);
    expect((rows.schemes[0] as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/i);
    // A summary statement carries no advisor, so nothing may be inferred.
    expect((rows.schemes[0] as { advisor_code: string | null }).advisor_code).toBeNull();
  });
});
