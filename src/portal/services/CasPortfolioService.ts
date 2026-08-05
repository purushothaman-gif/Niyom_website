/**
 * CasPortfolioService — the client's mutual funds, as their own statement states
 * them.
 *
 * This module is I/O only. Every decision it makes on the way — ownership,
 * cash-flow signs, which source wins, staleness — lives in `cas/model.ts` as
 * pure functions, so they can be tested without a database.
 *
 * ## Why this supersedes nw_holdings for mutual funds
 *
 * nw_holdings is hand-maintained by staff and only ever contained what we sold.
 * A CAS contains everything the client holds, including funds bought elsewhere,
 * so once a reconciled statement exists it is both more complete and more
 * current than anything we typed in.
 *
 * They are therefore alternatives, never a union: a fund we sold appears in
 * BOTH, and merging would show it twice and double its value.
 *
 * ## What is deliberately NOT read from here
 *
 * Only mutual funds. Bonds, insurance, fixed deposits and unlisted shares stay
 * with nw_holdings — a CAS knows nothing about them, and they carry DSA pricing
 * and trail fields no statement could supply.
 *
 * ## Only reconciled imports
 *
 * `status = 'reconciled'` means the parse matched the totals printed on the
 * statement itself. Anything else is stored for diagnosis and must never reach
 * a screen: a portfolio that is quietly short is worse than one that is absent.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { CasHoldingMeta, PortalHolding } from '../types/cas';
import {
  isOpenPosition,
  mergeStatements,
  migrationCandidates,
  toFlow,
  toHolding,
  hasCompleteHistory,
  type CasImportMeta,
  type CasCashFlow,
  type CasSchemeRow,
  type CasTxnRow,
} from './cas/model';

export type { CasCashFlow } from './cas/model';

export interface CasPortfolio {
  /** The newest contributing statement — kept for callers that name just one. */
  importId: string;
  /** Every statement that contributed, newest first. */
  importIds: string[];
  /**
   * The date the portfolio is good to. With several statements this is the
   * OLDEST of their end dates: a portfolio is only as current as its stalest
   * part, and claiming the newest date would date the whole picture by the
   * freshest slice of it.
   */
  statementTo: string | null;
  importedAt: string;
  holdings: PortalHolding[];
  flows: CasCashFlow[];
  /**
   * False when a statement begins mid-history, leaving opening balances that
   * no transaction explains. The holdings are still right; a return computed
   * from these flows would not be. With several statements it takes only one
   * truncated statement to make the combined flows unusable.
   */
  historyComplete: boolean;
  /** The date the statement starts, for explaining a truncated history. */
  statementFrom: string | null;
}

const SCHEME_COLUMNS =
  'id,import_id,name,units,nav,nav_date,value,cost,isin,rta,rta_code,advisor_code,is_ours,' +
  'cas_folios(folio_number,amc,registrar)';

/**
 * PostgREST caps every response, and Supabase's cap is 1000 rows.
 *
 * It does not error and it does not warn — the array is simply short. A client
 * with 1,639 transactions received the oldest 1,000, so every scheme's ledger
 * fell short of its closing balance, `hasCompleteHistory` concluded the
 * statement was truncated, and their return was suppressed. The portfolio value
 * looked perfect throughout, because 34 schemes fit inside one page.
 *
 * Anything that can exceed a thousand rows has to be read page by page.
 */
export const PAGE_SIZE = 1000;

/**
 * Read every page. Exported for its own test: the boundary that matters is a
 * row count that is an exact multiple of the page size, where stopping early
 * loses everything after it and stopping late costs one empty request.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    // A short page is the last one. A full page might be the last one too, so
    // the loop asks again and stops on the empty response.
    if (rows.length < pageSize) return all;
  }
}

export const CasPortfolioService = {
  /**
   * Everything the client's reconciled statements say, combined.
   *
   * One CAS covers the folios registered against one email address, and a
   * client with two email addresses has two statements that are each complete
   * for their own half and silent about the other. Reading only the newest —
   * which is what this did — showed whichever half was uploaded last.
   *
   * ## Not a union: a merge with a rule
   *
   * The same fund in the same folio can appear in both statements (a client who
   * re-requests a CAS, or whose folios overlap), and adding both would double
   * that money. Positions are therefore keyed on folio + ISIN and the FRESHER
   * statement wins outright for each one — its units, its NAV, and its
   * transactions. The loser's rows are dropped whole, so a position's ledger
   * always comes from a single statement and its cash flows cannot interleave
   * two versions of the same purchase.
   */
  async getPortfolio(clientId: string): Promise<CasPortfolio | null> {
    const { data } = await supabase
      .from('cas_imports')
      .select('id,statement_from,statement_to,created_at')
      .eq('client_id', clientId)
      .eq('status', 'reconciled')
      // Freshest statement first — this ordering IS the tie-break below.
      .order('statement_to', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    const imports = (data ?? []) as CasImportMeta[];
    if (imports.length === 0) return null;

    const importIds = imports.map((i) => i.id);

    /*
     * Both reads are paged, and both order by a UNIQUE tiebreaker as well as
     * their display key. Without one, rows sharing a txn_date (or a value) can
     * be returned in a different order on each request, so a row can appear on
     * two pages or on none — silent duplication or loss in a ledger.
     */
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
      fetchAllPages<CasTxnRow>((from, to) =>
        supabase
          .from('cas_transactions')
          .select('id,scheme_id,txn_date,txn_type,amount,units')
          .in('import_id', importIds)
          .order('txn_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: CasTxnRow[] | null; error: unknown }>,
      ),
    ]);

    const merged = mergeStatements(imports, allSchemes, allTxns);
    const { schemes, txns } = merged;
    const dateOf = new Map(merged.contributing.map((i) => [i.id, i.statement_to ?? null]));
    const importedAt = imports[0].created_at ?? new Date().toISOString();

    const holdings = schemes.filter(isOpenPosition).map((s) =>
      toHolding(s, {
        clientId,
        importId: s.import_id ?? imports[0].id,
        importedAt,
        // Each holding is dated by the statement it actually came from.
        statementTo: dateOf.get(s.import_id ?? '') ?? null,
      }),
    );

    return {
      importId: imports[0].id,
      importIds,
      // Only as current as the stalest contributing statement.
      statementTo: merged.statementTo,
      statementFrom: merged.statementFrom,
      importedAt,
      holdings,
      flows: txns.map(toFlow).filter((f): f is CasCashFlow => f !== null),
      historyComplete: hasCompleteHistory(
        // The name carries the one exemption: a side-pocketed scheme's units
        // were credited, not bought, so they explain no missing cash flow.
        schemes.map((s) => ({ id: s.id, units: s.units, name: s.name })),
        txns as { scheme_id?: string | null; units: number | null }[],
      ),
    };
  },

  /**
   * Every held-away folio, for a future ARN migration.
   *
   * The seam the migration wizard will read: it answers "what could be moved"
   * from stored rows, so nothing has to re-parse a client's statement. Not a
   * migration itself — no transfer, no form, no side effect.
   */
  async listMigrationCandidates(clientId: string): Promise<CasHoldingMeta[]> {
    const portfolio = await this.getPortfolio(clientId);
    return portfolio ? migrationCandidates(portfolio.holdings) : [];
  },
};
