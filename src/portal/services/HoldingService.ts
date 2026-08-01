/**
 * HoldingService
 * -----------------------------------------------------------------------------
 * The ONLY portal boundary that talks to Supabase for client wealth data.
 * Components and hooks call this; they never import `supabase` directly.
 *
 * This keeps the data source swappable: when holdings/transactions eventually
 * flow from a BSE-backed sync, only this file changes.
 *
 * ## One source per asset class, deliberately not merged
 *
 *   Mutual funds      the client's own CAS, once one has been imported and
 *                     reconciled; nw_holdings until then
 *   Bonds             nw_holdings
 *   Unlisted shares   nw_holdings
 *   Insurance         nw_holdings
 *   Fixed deposits    nw_holdings
 *
 * For mutual funds the two are alternatives rather than a union. A fund the
 * client bought through us appears in BOTH — in nw_holdings because we recorded
 * the sale, and in the CAS because the registrar did — so combining them would
 * list it twice and double its value. The CAS wins where it applies: it is
 * complete, covering funds bought elsewhere that we could never have recorded.
 *
 * Nothing else is touched by an import. A statement knows nothing about a bond
 * or a policy, so those rows pass straight through.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWClient, NWHolding, NWTransaction } from '../../crm/types';
import type { CasFreshness, PortalHolding } from '../types/cas';
import { CasPortfolioService } from './CasPortfolioService';
import {
  assessCasFreshness,
  portfolioDayChange,
  selectHoldings,
  valuationDate,
  type CasCashFlow,
} from './cas/model';

// Re-exported so existing importers of these from HoldingService keep working.
export { selectHoldings } from './cas/model';

export interface ClientWealthSnapshot {
  client: NWClient | null;
  holdings: PortalHolding[];
  transactions: NWTransaction[];
  /** Where the mutual fund holdings above came from. */
  mfSource: 'cas' | 'manual';
  /** The date the statement was drawn up to — MF figures are as of then. */
  casStatementTo: string | null;
  /** Whether our own records show mutual fund activity after that date. */
  casFreshness: CasFreshness;
  /**
   * Cash flows from the statement's own ledger, for a real money-weighted
   * return. Empty when no statement has been imported.
   */
  casFlows: CasCashFlow[];
  /**
   * False when the imported statement starts mid-history. Holdings stay correct;
   * the return is suppressed, because flows that do not explain the closing
   * value produce an answer that is not merely imprecise but absurd.
   */
  historyComplete: boolean;
  /** Where the statement's period begins, for explaining a suppressed return. */
  casStatementFrom: string | null;
  /** Value change across the last published NAV move; null when not revalued. */
  dayChange: number | null;
  /** The date the mutual fund valuations are as at, when newer than the statement. */
  valuedOn: string | null;
}

export const HoldingService = {
  /** Fetch the client, all holdings, and recent transactions in one round-trip. */
  async getSnapshot(clientId: string): Promise<ClientWealthSnapshot> {
    const [clientRes, holdingsRes, txnRes, latestMfRes, cas] = await Promise.all([
      supabase.from('nw_clients').select('*').eq('id', clientId).maybeSingle(),
      supabase
        .from('nw_holdings')
        .select('*')
        .eq('client_id', clientId)
        .order('current_value', { ascending: false }),
      supabase
        .from('nw_transactions')
        .select('*')
        .eq('client_id', clientId)
        .order('txn_date', { ascending: false })
        .limit(25),
      /*
       * Asked for separately rather than scanned out of the 25 above: those are
       * the most recent transactions across ALL products, so a client with a
       * busy month of bond activity could push their latest fund transaction
       * out of the window and make a stale statement look current.
       */
      supabase
        .from('nw_transactions')
        .select('txn_date')
        .eq('client_id', clientId)
        .eq('product_type', 'mutual_fund')
        .order('txn_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Best-effort: a client with no import, or a failure reading one, still
      // gets the portfolio we hold for them rather than an error screen.
      CasPortfolioService.getPortfolio(clientId).catch(() => null),
    ]);

    const manual = (holdingsRes.data as NWHolding[]) ?? [];
    const latestOwnMfTxnDate = (latestMfRes.data?.txn_date as string) ?? null;
    const holdings = selectHoldings(manual, cas?.holdings ?? null);

    return {
      client: (clientRes.data as NWClient) ?? null,
      holdings,
      transactions: (txnRes.data as NWTransaction[]) ?? [],
      mfSource: cas ? 'cas' : 'manual',
      casStatementTo: cas?.statementTo ?? null,
      casFreshness: assessCasFreshness(cas?.statementTo ?? null, latestOwnMfTxnDate),
      casFlows: cas?.flows ?? [],
      historyComplete: cas ? cas.historyComplete : true,
      casStatementFrom: cas?.statementFrom ?? null,
      dayChange: portfolioDayChange(holdings),
      valuedOn: valuationDate(holdings),
    };
  },
};
