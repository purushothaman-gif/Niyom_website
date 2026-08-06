/**
 * CasGainsService — the client's capital gains, from their own statements.
 *
 * I/O only. Every judgement — FIFO order, grandfathering, holding periods, which
 * disposals may be reported at all — lives in `cas/gains.ts` as pure functions,
 * so the numbers that end up on a tax return can be tested without a database.
 *
 * ## Why it reads the same way CasPortfolioService does
 *
 * Both answer questions about the same statements, and they must never disagree.
 * So this uses the identical merge (`mergeStatements`), the identical "only
 * reconciled imports" rule and the identical paging — because a gains statement
 * built from a different subset of the data than the holdings screen is a
 * support call waiting to happen.
 *
 * ## What it needs that the portfolio does not
 *
 * Three extra reads, all market reference data rather than client data:
 *
 *   mf_asset_class    what each fund holds, which fixes its rate and its
 *                     holding period. NULL where nobody has decided yet.
 *   nav_daily @ 2018  the 31-Jan-2018 NAV, for grandfathering pre-2018 units.
 *   nav_daily latest  for valuing what is still held.
 *
 * And `balance_units` on every transaction, which is the only reliable evidence
 * of same-day ordering — see `inLedgerOrder`.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { fetchAllPages } from '../../lib/supabasePaging';
import { mergeStatements, type CasImportMeta, type CasSchemeRow } from './cas/model';
import {
  allDisposals,
  computeGains,
  excludedSchemes,
  financialYearsWithDisposals,
  summariseFinancialYear,
  undecidedSchemes,
  type AssetClass,
  type Disposal,
  type FinancialYearGains,
  type GainsTxn,
  type SchemeGains,
} from './cas/gains';

/** The date equity grandfathering is measured on. */
const GRANDFATHER_DATE = '2018-01-31';

export interface GainsStatement {
  /** Per scheme, including the ones that could not be computed. */
  schemes: SchemeGains[];
  /** Every reportable disposal across the portfolio. */
  disposals: Disposal[];
  /** Financial years that contain a disposal, newest first. */
  financialYears: string[];
  /** Funds omitted because their history is truncated, with the reason. */
  excluded: { name: string; reason: string }[];
  /** Funds whose tax treatment is waiting on a decision about the fund. */
  undecided: string[];
  /** Unrealised gain on everything still held, where a NAV is known. */
  unrealised: number | null;
  /** The date the statements are good to. */
  statementTo: string | null;
  /** True when every contributing statement covers its full history. */
  complete: boolean;
}

const SCHEME_COLUMNS = 'id,import_id,name,units,nav,nav_date,value,cost,isin,rta,rta_code,advisor_code,is_ours,cas_folios(folio_number,amc,registrar)';

/** Read a reference table keyed by ISIN, in chunks the URL can carry. */
async function byIsinChunks<T>(
  isins: string[],
  read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  // `in.(...)` goes in the query string, so a client holding hundreds of funds
  // would otherwise build a URL long enough to be rejected.
  for (let i = 0; i < isins.length; i += 100) {
    const { data } = await read(isins.slice(i, i + 100));
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export const CasGainsService = {
  /**
   * Build the client's capital gains statement.
   *
   * Returns null when there is nothing reconciled to build it from — which the
   * screen shows as "import a statement", not as "no gains".
   */
  async getStatement(clientId: string): Promise<GainsStatement | null> {
    const { data } = await supabase
      .from('cas_imports')
      .select('id,statement_from,statement_to,created_at')
      .eq('client_id', clientId)
      .eq('status', 'reconciled')
      // Freshest first — this ordering IS the merge tie-break.
      .order('statement_to', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    const imports = (data ?? []) as CasImportMeta[];
    if (imports.length === 0) return null;
    const importIds = imports.map((i) => i.id);

    const [allSchemes, allTxns] = await Promise.all([
      fetchAllPages<CasSchemeRow>((from, to) =>
        supabase
          .from('cas_schemes')
          .select(SCHEME_COLUMNS)
          .in('import_id', importIds)
          .order('value', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: CasSchemeRow[] | null; error: unknown }>,
      ),
      /*
       * `balance_units` is requested here and nowhere else in the portal. It is
       * the registrar's running balance after each row, and the only way to
       * recover the true order of transactions that share a date — 52 days in
       * the book pair a purchase with the reversal that cancels it.
       */
      fetchAllPages<GainsTxn & { id: string }>((from, to) =>
        supabase
          .from('cas_transactions')
          .select('id,scheme_id,txn_date,txn_type,amount,units,nav,balance_units')
          .in('import_id', importIds)
          .order('txn_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: (GainsTxn & { id: string })[] | null; error: unknown }>,
      ),
    ]);

    const merged = mergeStatements(imports, allSchemes, allTxns as never);
    const schemes = merged.schemes;
    const keptIds = new Set(schemes.map((s) => s.id));
    const txns = (allTxns as GainsTxn[]).filter((t) => t.scheme_id && keptIds.has(t.scheme_id));

    const isins = [...new Set(schemes.map((s) => s.isin).filter((i): i is string => !!i))];

    const [classRows, gfRows, navRows] = await Promise.all([
      // Read as the column really is — text — and narrowed below. Declaring it
      // as AssetClass here was asserting a union the database cannot guarantee.
      byIsinChunks<{ isin: string; effective_asset_class: string | null }>(isins, (chunk) =>
        supabase.from('mf_asset_class').select('isin,effective_asset_class').in('isin', chunk),
      ),
      byIsinChunks<{ isin: string; nav: number | string }>(isins, (chunk) =>
        supabase.from('nav_daily').select('isin,nav').eq('nav_date', GRANDFATHER_DATE).in('isin', chunk),
      ),
      byIsinChunks<{ isin: string; nav: number | string; nav_date: string }>(isins, (chunk) =>
        supabase
          .from('nav_daily')
          .select('isin,nav,nav_date')
          .in('isin', chunk)
          .gte('nav_date', new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
          .order('nav_date', { ascending: false }),
      ),
    ]);

    /*
     * `effective_asset_class` is a text column. Its inputs carry CHECK
     * constraints, so in practice it only ever holds these three values — but
     * "in practice" is not a guarantee, and the cost of being wrong is a tax
     * rate applied on a value nobody recognises. Anything unexpected becomes
     * null, which the engine already treats as "undecided": the gain is still
     * reported, the treatment simply waits for a human.
     */
    const toAssetClass = (v: string | null): AssetClass | null =>
      v === 'equity' || v === 'debt' || v === 'other' ? v : null;

    const assetClassByIsin = new Map<string, AssetClass | null>(
      classRows.map((r) => [r.isin, toAssetClass(r.effective_asset_class)]),
    );
    const grandfatherNavByIsin = new Map<string, number>(
      gfRows.map((r) => [r.isin, Number(r.nav)]).filter(([, n]) => Number.isFinite(n as number)) as [string, number][],
    );
    // Rows arrive newest first, so the first sighting of an ISIN is its latest.
    const currentNavByIsin = new Map<string, number>();
    for (const r of navRows) {
      if (!currentNavByIsin.has(r.isin)) currentNavByIsin.set(r.isin, Number(r.nav));
    }

    const computed = computeGains(
      schemes.map((s) => ({ id: s.id, name: s.name, isin: s.isin, units: s.units })),
      txns,
      { assetClassByIsin, grandfatherNavByIsin, currentNavByIsin },
    );

    const disposals = allDisposals(computed);
    const unrealisedParts = computed.map((s) => s.unrealised).filter((u): u is number => u !== null);

    return {
      schemes: computed,
      disposals,
      financialYears: financialYearsWithDisposals(disposals),
      excluded: excludedSchemes(computed),
      undecided: undecidedSchemes(computed),
      unrealised: unrealisedParts.length
        ? Number(unrealisedParts.reduce((a, b) => a + b, 0).toFixed(2))
        : null,
      statementTo: merged.statementTo,
      complete: computed.every((s) => s.complete),
    };
  },

  /**
   * One financial year's totals.
   *
   * Always computed from the WHOLE portfolio's disposals, never one scheme's —
   * the ₹1.25L exemption belongs to the taxpayer, and applying it per fund would
   * understate the tax by most of itself.
   */
  summarise(statement: GainsStatement, fy: string): FinancialYearGains {
    return summariseFinancialYear(statement.disposals, fy);
  },
};
