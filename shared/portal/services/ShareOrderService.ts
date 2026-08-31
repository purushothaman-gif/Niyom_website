/**
 * ShareOrderService
 * -----------------------------------------------------------------------------
 * Client-portal unlisted-share exploration + ordering. A client sees the shares
 * priced at their approved markup (nw_client_unlisted_shares /
 * nw_client_unlisted_share — the marked-up price and safe facts only, never the
 * base price or the markup itself) and orders by quantity. Placing goes through
 * the `place-share-order` edge function so the price is re-derived server-side
 * and the assigned RM is alerted + emailed.
 *
 * All reads run through `clientSupabase` (RLS resolves the client via auth.uid()),
 * which is the same isolation the bond service relies on — the portal's client
 * session must not collide with an employee session in the same browser.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { getEnv } from '../../platform/env';

/** One unlisted share as the client may see it. */
export interface ClientShare {
  id: string;
  isin: string;
  company_name: string;
  short_name: string | null;
  sector: string | null;
  about: string | null;
  logo_url: string | null;
  website: string | null;
  face_value: number | null;
  lot_size: number | null;
  min_qty: number | null;
  client_price: number | null;
}

export type ShareOrderStatus = 'submitted' | 'deal_sent' | 'accepted' | 'cancelled';

export interface ShareOrder {
  id: string;
  ref: string;
  share_id: string | null;
  isin: string;
  company_name: string;
  qty: number;
  price_per_share: number;
  amount: number | null;
  status: ShareOrderStatus;
  notes: string;
  created_at: string;
}

export interface PlaceShareOrderInput {
  clientId: string;
  shareId: string;
  qty: number;
  notes?: string;
}

export const ShareOrderService = {
  /** The shares visible to this client (approved rate only; empty otherwise). */
  async getShares(): Promise<ClientShare[]> {
    const { data, error } = await supabase.rpc('nw_client_unlisted_shares');
    if (error) throw new Error(error.message);
    return (data as unknown as ClientShare[]) ?? [];
  },

  /** A single share for the detail page. null if it isn't available to this client. */
  async getShare(id: string): Promise<ClientShare | null> {
    const { data, error } = await supabase.rpc('nw_client_unlisted_share', {
      p_id: id as unknown as string,
    });
    if (error) throw new Error(error.message);
    const rows = (data as unknown as ClientShare[]) ?? [];
    return rows[0] ?? null;
  },

  /** This client's own share orders, newest first. */
  async getMyOrders(clientId: string): Promise<ShareOrder[]> {
    const { data, error } = await supabase
      .from('nw_share_orders')
      .select('id, ref, share_id, isin, company_name, qty, price_per_share, amount, status, notes, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as unknown as ShareOrder[]) ?? [];
  },

  /**
   * Place an order. The edge function re-derives the price, enforces the lot
   * rule, inserts the order (firing the RM alert) and emails the RM. Returns the
   * created order with the authoritative server-side price/amount.
   */
  async placeOrder(input: PlaceShareOrderInput): Promise<ShareOrder> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const anon = getEnv().supabaseAnonKey;
    const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/place-share-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? anon}`,
        Apikey: anon,
      },
      body: JSON.stringify({
        client_id: input.clientId,
        share_id: input.shareId,
        qty: input.qty,
        notes: input.notes ?? '',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.order) {
      throw new Error(body?.error || 'Could not place your order. Please try again.');
    }
    return body.order as ShareOrder;
  },
};
