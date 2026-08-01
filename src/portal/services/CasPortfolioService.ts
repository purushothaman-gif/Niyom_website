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
  applyNav,
  isOpenPosition,
  migrationCandidates,
  toFlow,
  toHolding,
  hasCompleteHistory,
  toNavQuotes,
  type CasCashFlow,
  type CasSchemeRow,
  type CasTxnRow,
  type NavRow,
} from './cas/model';

export type { CasCashFlow } from './cas/model';

export interface CasPortfolio {
  importId: string;
  /** The date the statement was drawn up to — everything here is as of then. */
  statementTo: string | null;
  importedAt: string;
  holdings: PortalHolding[];
  flows: CasCashFlow[];
  /**
   * False when the statement begins mid-history, leaving opening balances that
   * no transaction explains. The holdings are still right; a return computed
   * from these flows would not be.
   */
  historyComplete: boolean;
  /** The date the statement starts, for explaining a truncated history. */
  statementFrom: string | null;
}

/**
 * How far back to look for a quote.
 *
 * Long enough to cover a long weekend or a stalled feed, short enough that a
 * wound-up scheme's years-old final NAV is not presented as today's price. A
 * scheme with nothing inside the window simply keeps its statement valuation.
 */
const NAV_LOOKBACK_DAYS = 15;

async function loadNavQuotes(isins: string[]) {
  const unique = [...new Set(isins)].filter(Boolean);
  if (!unique.length) return new Map();
  const since = new Date(Date.now() - NAV_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('nav_daily')
    .select('isin,nav,nav_date')
    .in('isin', unique)
    .gte('nav_date', since)
    .order('nav_date', { ascending: false });
  if (error || !data) return new Map();
  return toNavQuotes(data as NavRow[]);
}

const SCHEME_COLUMNS =
  'id,name,units,nav,nav_date,value,cost,isin,rta,rta_code,advisor_code,is_ours,' +
  'cas_folios(folio_number,amc,registrar)';

export const CasPortfolioService = {
  /**
   * The client's most recent reconciled statement, or null if they have none.
   *
   * Newest wins outright rather than being merged with older imports: each CAS
   * is a complete picture as of its own date, so combining two would double
   * every fund that appears in both.
   */
  async getPortfolio(clientId: string): Promise<CasPortfolio | null> {
    const { data: imp } = await supabase
      .from('cas_imports')
      .select('id,statement_from,statement_to,created_at')
      .eq('client_id', clientId)
      .eq('status', 'reconciled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!imp) return null;

    const importId = imp.id as string;
    const importedAt = (imp.created_at as string) ?? new Date().toISOString();
    const statementTo = (imp.statement_to as string) ?? null;
    const statementFrom = (imp.statement_from as string) ?? null;

    const [schemeRes, txnRes] = await Promise.all([
      supabase
        .from('cas_schemes')
        .select(SCHEME_COLUMNS)
        .eq('import_id', importId)
        .order('value', { ascending: false }),
      supabase
        .from('cas_transactions')
        .select('scheme_id,txn_date,txn_type,amount,units')
        .eq('import_id', importId)
        .order('txn_date', { ascending: true }),
    ]);

    const schemes = (schemeRes.data ?? []) as unknown as CasSchemeRow[];
    const txns = (txnRes.data ?? []) as CasTxnRow[];

    const holdings = schemes
      .filter(isOpenPosition)
      .map((s) => toHolding(s, { clientId, importId, importedAt, statementTo }));

    /*
     * Revalue at the latest published NAV, so an imported portfolio is not
     * frozen on the day it was imported. Best-effort: a NAV feed that is down
     * or behind must leave the statement's own valuation showing rather than
     * fail the whole portfolio.
     */
    const quotes = await loadNavQuotes(holdings.map((h) => h.cas?.isin ?? '').filter(Boolean));

    return {
      importId,
      statementTo,
      importedAt,
      holdings: holdings.map((h) => applyNav(h, quotes.get(h.cas?.isin ?? ''))),
      flows: txns.map(toFlow).filter((f): f is CasCashFlow => f !== null),
      historyComplete: hasCompleteHistory(
        schemes.map((s) => ({ id: s.id, units: s.units })),
        txns as { scheme_id?: string | null; units: number | null }[],
      ),
      statementFrom,
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
