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

    const [schemeRes, txnRes] = await Promise.all([
      supabase
        .from('cas_schemes')
        .select(SCHEME_COLUMNS)
        .in('import_id', importIds)
        .order('value', { ascending: false }),
      supabase
        .from('cas_transactions')
        .select('scheme_id,txn_date,txn_type,amount,units')
        .in('import_id', importIds)
        .order('txn_date', { ascending: true }),
    ]);

    const merged = mergeStatements(
      imports,
      (schemeRes.data ?? []) as unknown as CasSchemeRow[],
      (txnRes.data ?? []) as CasTxnRow[],
    );
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
