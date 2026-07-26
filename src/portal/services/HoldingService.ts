/**
 * HoldingService
 * -----------------------------------------------------------------------------
 * The ONLY portal boundary that talks to Supabase for client wealth data.
 * Components and hooks call this; they never import `supabase` directly.
 *
 * This keeps the data source swappable: when holdings/transactions eventually
 * flow from a BSE-backed sync, only this file changes.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWClient, NWHolding, NWTransaction } from '../../crm/types';

export interface ClientWealthSnapshot {
  client: NWClient | null;
  holdings: NWHolding[];
  transactions: NWTransaction[];
}

export const HoldingService = {
  /** Fetch the client, all holdings, and recent transactions in one round-trip. */
  async getSnapshot(clientId: string): Promise<ClientWealthSnapshot> {
    const [clientRes, holdingsRes, txnRes] = await Promise.all([
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
    ]);

    return {
      client: (clientRes.data as NWClient) ?? null,
      holdings: (holdingsRes.data as NWHolding[]) ?? [],
      transactions: (txnRes.data as NWTransaction[]) ?? [],
    };
  },
};
