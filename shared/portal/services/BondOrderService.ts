/**
 * BondOrderService
 * -----------------------------------------------------------------------------
 * Client-portal bond exploration + ordering. A client sees the bonds priced at
 * their approved markup (nw_client_bonds / nw_client_bond — marked-up price and
 * safe facts only, never base price / cost / margin) and places an order by
 * quantity (units). Placing goes through the `place-bond-order` edge function so
 * the price is re-derived server-side and the assigned RM is alerted + emailed.
 * All reads run through `clientSupabase` (RLS resolves the client via auth.uid()).
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { getEnv } from '../../platform/env';

/** The analytics blob the enrich pipeline stores on each bond (subset we read). */
export interface BondAnalytics {
  ytm?: number | null;
  current_yield?: number | null;
  accrued_per_100?: number | null;
  accrued_days?: number | null;
  clean_price?: number | null;
  dirty_price?: number | null;
  days_to_maturity?: number | null;
  years_to_maturity?: number | null;
  modified_duration?: number | null;
  total_future_interest_per_100?: number | null;
  [k: string]: unknown;
}

/** One bond as the client may see it — marked-up price + safe factual fields. */
export interface ClientBond {
  id: string;
  isin: string;
  bond_name: string | null;
  issuer_name: string | null;
  coupon_rate: number | null;
  coupon_type: string | null;
  coupon_frequency: string | null;
  maturity_date: string | null;
  next_coupon_date: string | null;
  issue_date: string | null;
  rating: string | null;
  rating_agency: string | null;
  security_type: string | null;
  tax_status: string | null;
  trustee: string | null;
  day_count_convention: string | null;
  principal_repayment_structure: string | null;
  min_investment: number | null;
  face_value: number | null;
  client_price: number | null;
  analytics: BondAnalytics | null;
}

export type BondOrderStatus = 'submitted' | 'deal_sent' | 'accepted' | 'cancelled';

export interface BondOrder {
  id: string;
  ref: string;
  bond_id: string | null;
  isin: string;
  bond_name: string;
  units: number;
  price_per_100: number;
  face_value: number | null;
  amount: number | null;
  status: BondOrderStatus;
  notes: string;
  created_at: string;
}

export interface PlaceOrderInput {
  clientId: string;
  bondId: string;
  units: number;
  notes?: string;
}

export const BondOrderService = {
  /** The bonds visible to this client (approved rate only; empty otherwise). */
  async getBonds(): Promise<ClientBond[]> {
    const { data, error } = await supabase.rpc('nw_client_bonds');
    if (error) throw new Error(error.message);
    return (data as unknown as ClientBond[]) ?? [];
  },

  /** A single bond for the detail page. null if it isn't available to this client. */
  async getBond(id: string): Promise<ClientBond | null> {
    const { data, error } = await supabase.rpc('nw_client_bond', {
      p_id: id as unknown as string,
    });
    if (error) throw new Error(error.message);
    const rows = (data as unknown as ClientBond[]) ?? [];
    return rows[0] ?? null;
  },

  /** This client's own orders, newest first. */
  async getMyOrders(clientId: string): Promise<BondOrder[]> {
    const { data, error } = await supabase
      .from('nw_bond_orders')
      .select('id, ref, bond_id, isin, bond_name, units, price_per_100, face_value, amount, status, notes, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as unknown as BondOrder[]) ?? [];
  },

  /**
   * Place an order. The edge function re-derives the price, enforces the lot
   * rule, inserts the order (firing the RM alert) and emails the RM. Returns the
   * created order (with the authoritative server-side price/amount).
   */
  async placeOrder(input: PlaceOrderInput): Promise<BondOrder> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const anon = getEnv().supabaseAnonKey;
    const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/place-bond-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? anon}`,
        Apikey: anon,
      },
      body: JSON.stringify({
        client_id: input.clientId,
        bond_id: input.bondId,
        units: input.units,
        notes: input.notes ?? '',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.order) {
      throw new Error(body?.error || 'Could not place your order. Please try again.');
    }
    return body.order as BondOrder;
  },
};
