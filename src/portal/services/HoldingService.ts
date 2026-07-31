/**
 * HoldingService
 * -----------------------------------------------------------------------------
 * The ONLY portal boundary that talks to Supabase for client wealth data.
 * Components and hooks call this; they never import `supabase` directly.
 *
 * This keeps the data source swappable: when holdings/transactions eventually
 * flow from a BSE-backed sync, only this file changes.
 *
 * ## Two sources, deliberately not merged
 *
 * Mutual funds come from the client's own Consolidated Account Statement once
 * they have imported one that reconciles; everything else comes from
 * nw_holdings, which staff maintain.
 *
 * They are alternatives rather than a union. A fund the client bought through
 * us appears in BOTH — in nw_holdings because we recorded the sale, and in the
 * CAS because the registrar did — so combining them would list it twice and
 * double its value. The CAS wins where it applies: it is complete, covering
 * funds bought elsewhere that we could never have recorded.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWClient, NWHolding, NWTransaction } from '../../crm/types';
import { CasPortfolioService, type CasCashFlow } from './CasPortfolioService';

export interface ClientWealthSnapshot {
  client: NWClient | null;
  holdings: NWHolding[];
  transactions: NWTransaction[];
  /** Where the mutual fund holdings above came from. */
  mfSource: 'cas' | 'manual';
  /** The date the statement was drawn up to — MF figures are as of then. */
  casStatementTo: string | null;
  /**
   * Cash flows from the statement's own ledger, for a real money-weighted
   * return. Empty when no statement has been imported.
   */
  casFlows: CasCashFlow[];
}

/**
 * Choose between the two sources for mutual funds.
 *
 * Separate and exported because getting this wrong is invisible and expensive:
 * concatenating instead of replacing shows every fund bought through us twice
 * and doubles the client's net worth, and nothing about the resulting screen
 * looks broken.
 */
export function selectHoldings(manual: NWHolding[], casHoldings: NWHolding[] | null): NWHolding[] {
  if (!casHoldings) return manual;
  return [...manual.filter((h) => h.product_type !== 'mutual_fund'), ...casHoldings].sort(
    (a, b) => (b.current_value || 0) - (a.current_value || 0),
  );
}

export const HoldingService = {
  /** Fetch the client, all holdings, and recent transactions in one round-trip. */
  async getSnapshot(clientId: string): Promise<ClientWealthSnapshot> {
    const [clientRes, holdingsRes, txnRes, cas] = await Promise.all([
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
      // Best-effort: a client with no import, or a failure reading one, still
      // gets the portfolio we hold for them rather than an error screen.
      CasPortfolioService.getPortfolio(clientId).catch(() => null),
    ]);

    const manual = (holdingsRes.data as NWHolding[]) ?? [];

    return {
      client: (clientRes.data as NWClient) ?? null,
      holdings: selectHoldings(manual, cas?.holdings ?? null),
      transactions: (txnRes.data as NWTransaction[]) ?? [],
      mfSource: cas ? 'cas' : 'manual',
      casStatementTo: cas?.statementTo ?? null,
      casFlows: cas?.flows ?? [],
    };
  },
};
