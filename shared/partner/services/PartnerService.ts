/**
 * PartnerService — every read the partner portal makes.
 *
 * Two rules hold everywhere in src/partner:
 *   1. Always `partnerSupabase`, never the default or client instance. The three
 *      sessions coexist in one browser under separate storage keys; using the
 *      wrong one makes nw_current_dsa_id() return NULL and every RPC raises
 *      "Partner access required".
 *   2. Always an RPC, never a table. Partners have no SELECT policy on
 *      nw_clients / nw_holdings / nw_transactions / nw_dsa — RLS grants rows,
 *      not columns, so a table read would expose client PAN/DOB/bank and the
 *      firm's margin fields. The nw_partner_* functions project explicitly.
 */
import { partnerSupabase as supabase } from '../../lib/supabase';
import {
  isDemoSession,
  demoProfile, demoClients, demoPortfolios, demoTransactions,
  demoPayout, demoNotes, demoReferral, demoLeads,
} from '../demo/demoData';
import {
  demoBonds, demoBond, demoShares, demoShare,
  setDemoBondMarkup, setDemoShareMarkup,
  demoBondOrders, demoShareOrders, addDemoBondOrder, addDemoShareOrder,
} from '../demo/demoMarket';
import type {
  PartnerIdentity,
  PartnerClientRow,
  PartnerHoldingRow,
  PartnerTransactionRow,
  PartnerPayoutSummary,
  PartnerDebitNote,
  PartnerReferral,
  PartnerLead,
} from '../types';
import { getEnv } from '../../platform/env';

/** Thrown when the RM has disabled the login (or deactivated the DSA) mid-session. */
export const PARTNER_ACCESS_REVOKED = 'PARTNER_ACCESS_REVOKED';

/** A bond as the partner sees it: their cost (base) + their own spread → partner_price. */
export interface PartnerBond {
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
  seniority: string | null;
  tax_status: string | null;
  trustee: string | null;
  day_count_convention: string | null;
  principal_repayment_structure: string | null;
  min_investment: number | null;
  face_value: number | null;
  partner_base: number | null;
  self_markup_percent: number | null;
  partner_price: number | null;
  analytics: {
    ytm?: number | null;
    years_to_maturity?: number | null;
    accrued_per_100?: number | null;
    total_future_interest_per_100?: number | null;
    total_future_principal_per_100?: number | null;
    [k: string]: unknown;
  } | null;
}

/** An unlisted share as the partner sees it: their cost (base) + their own spread. */
export interface PartnerShare {
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
  partner_base: number | null;
  self_markup_percent: number | null;
  partner_price: number | null;
}

function isAccessRevoked(message?: string) {
  return !!message && message.includes('Partner access required');
}

/**
 * Demo mode is intercepted HERE rather than in each page, because this service
 * is the single choke point for every read and both writes in src/partner. One
 * seam means no page can accidentally reach the database in demo mode, and the
 * pages themselves stay entirely unaware that demo mode exists.
 */

export const PartnerService = {
  async getProfile(): Promise<PartnerIdentity | null> {
    if (isDemoSession()) return demoProfile;
    const { data, error } = await supabase.rpc('nw_partner_profile');
    if (error) {
      // nw_current_dsa_id() embeds the enabled + active checks, so this is the
      // kill-switch firing: the caller should sign the partner out immediately
      // rather than showing a half-empty portal.
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    const rows = (data ?? []) as PartnerIdentity[];
    return rows[0] ?? null;
  },

  async getClients(): Promise<PartnerClientRow[]> {
    if (isDemoSession()) return demoClients;
    const { data, error } = await supabase.rpc('nw_partner_clients');
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return (data ?? []) as PartnerClientRow[];
  },

  async getClientPortfolio(clientId: string): Promise<PartnerHoldingRow[]> {
    if (isDemoSession()) return demoPortfolios[clientId] ?? [];
    const { data, error } = await supabase.rpc('nw_partner_client_portfolio', {
      p_client_id: clientId,
    });
    if (error) throw error;
    return (data ?? []) as PartnerHoldingRow[];
  },

  async getClientTransactions(clientId: string): Promise<PartnerTransactionRow[]> {
    if (isDemoSession()) return demoTransactions[clientId] ?? [];
    const { data, error } = await supabase.rpc('nw_partner_client_transactions', {
      p_client_id: clientId,
    });
    if (error) throw error;
    return (data ?? []) as PartnerTransactionRow[];
  },

  async getPayoutSummary(): Promise<PartnerPayoutSummary | null> {
    if (isDemoSession()) return demoPayout;
    const { data, error } = await supabase.rpc('nw_partner_payout_summary');
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    const rows = (data ?? []) as PartnerPayoutSummary[];
    return rows[0] ?? null;
  },

  async getDebitNotes(): Promise<PartnerDebitNote[]> {
    if (isDemoSession()) return demoNotes;
    const { data, error } = await supabase.rpc('nw_partner_debit_notes');
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return (data ?? []) as PartnerDebitNote[];
  },

  async getReferral(): Promise<PartnerReferral | null> {
    if (isDemoSession()) return demoReferral;
    const { data, error } = await supabase.rpc('nw_partner_referral');
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    const rows = (data ?? []) as PartnerReferral[];
    return rows[0] ?? null;
  },

  async getLeads(): Promise<PartnerLead[]> {
    if (isDemoSession()) return demoLeads;
    const { data, error } = await supabase.rpc('nw_partner_leads');
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return (data ?? []) as PartnerLead[];
  },

  /**
   * Submit a prospect. The edge function re-reads nw_dsa to confirm the caller
   * is an enabled, active partner — the JWT's is_partner metadata alone is not
   * treated as authoritative.
   */
  async submitLead(payload: {
    full_name: string;
    mobile: string;
    email?: string;
    city?: string;
    interested_product?: string;
    remarks?: string;
  }): Promise<{ ok: boolean; error?: string; lead_code?: string }> {
    // Demo mode is read-only: acknowledge the submission so the flow can be
    // demonstrated end to end, but never create a real lead. Prospects are
    // handed these credentials and will fill this form in.
    if (isDemoSession()) {
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true, lead_code: 'DEMO-LEAD' };
    }
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(
      `${getEnv().supabaseUrl}/functions/v1/partner-submit-lead`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
          Apikey: getEnv().supabaseAnonKey,
        },
        body: JSON.stringify(payload),
      },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error || 'Could not submit this lead.' };
    return { ok: true, lead_code: body?.lead_code };
  },

  /**
   * Verify a prospective client's PAN before onboarding them (Cashfree, via the
   * public PAN gate). Returns the legal name, or flags that the PAN is already a
   * registered client so the partner is stopped before creating a duplicate.
   */
  async verifyPan(pan: string): Promise<{ ok: boolean; alreadyRegistered?: boolean; name?: string; error?: string }> {
    if (isDemoSession()) {
      await new Promise((r) => setTimeout(r, 300));
      return { ok: true, name: 'PRIYA VENKATARAMAN' };
    }
    const anon = getEnv().supabaseAnonKey;
    const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/public-onboard-pan-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, Apikey: anon },
      body: JSON.stringify({ pan }),
    });
    const body = await res.json().catch(() => ({}));
    if (body?.already_registered) return { ok: false, alreadyRegistered: true, error: 'This PAN is already registered as a client.' };
    if (!res.ok || !body?.valid) return { ok: false, error: body?.error || 'PAN could not be verified.' };
    return { ok: true, name: body?.name_as_per_pan };
  },

  /**
   * Onboard one of the partner's own clients. Creates the client mapped under the
   * partner + their RM with an auto-generated client code (record only — the RM
   * completes KYC and enables the login). See partner-onboard-client edge fn.
   */
  async onboardClient(payload: {
    full_name: string;
    pan: string;
    phone: string;
    email: string;
    investment_preferences?: string[];
  }): Promise<{ ok: boolean; client_code?: string; error?: string }> {
    if (isDemoSession()) {
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true, client_code: 'NW-DEMO-0001' };
    }
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/partner-onboard-client`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
        Apikey: getEnv().supabaseAnonKey,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) return { ok: false, error: body?.error || 'Could not onboard the client.' };
    return { ok: true, client_code: body?.client_code };
  },

  /**
   * Short-lived signed URL for a statement PDF in the private dsa-debit-notes
   * bucket. The storage policy independently restricts objects to those
   * referenced by one of this partner's own notes, so a guessed path fails even
   * with a valid partner session.
   */
  async getStatementUrl(path: string): Promise<string | null> {
    // No signed URL in demo mode. The fixture notes carry a placeholder pdf_url
    // so the Open/Download affordances still render, but they must never reach
    // the private bucket that holds real partners' statements.
    if (isDemoSession()) return null;
    const { data, error } = await supabase.storage
      .from('dsa-debit-notes')
      .createSignedUrl(path, 120);
    if (error) return null;
    return data?.signedUrl ?? null;
  },

  /** Bonds the partner may sell, priced at their cost + their own <=5% spread. */
  async getBonds(): Promise<PartnerBond[]> {
    if (isDemoSession()) return demoBonds();
    const { data, error } = await supabase.rpc('nw_partner_bonds');
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return (data ?? []) as PartnerBond[];
  },

  /** A single bond for the partner detail page. null if not resolvable for this DSA. */
  async getBond(id: string): Promise<PartnerBond | null> {
    if (isDemoSession()) return demoBond(id);
    const { data, error } = await supabase.rpc('nw_partner_bond', { p_id: id as unknown as string });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    const rows = (data ?? []) as PartnerBond[];
    return rows[0] ?? null;
  },

  /** Set the partner's own bond markup (0..5%). Server enforces the cap. */
  async setBondMarkup(percent: number): Promise<void> {
    // Held for the session rather than dropped, so that saving a markup in the
    // sample portal visibly reprices the shelf — which is what the control is for.
    if (isDemoSession()) { setDemoBondMarkup(percent); return; }
    const { error } = await supabase.rpc('nw_partner_set_bond_markup', { p_percent: percent });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
  },

  /**
   * Place a bond order on behalf of one of the partner's clients, at the partner's
   * per-bond price. Goes through the place-partner-bond-order edge function, which
   * re-derives the price server-side and routes the order to the client's RM.
   */
  async placeBondOrder(input: { clientId: string; bondId: string; units: number; margin: number; notes?: string }): Promise<PartnerBondOrder> {
    if (isDemoSession()) {
      const bond = demoBond(input.bondId);
      if (!bond) throw new Error('Not available in the demo portal.');
      const client = demoClients.find((c) => c.client_id === input.clientId);
      await new Promise((r) => setTimeout(r, 500));
      return addDemoBondOrder(
        bond,
        client?.full_name ?? 'SAMPLE CLIENT',
        client?.client_code ?? 'NW-DEMO-0000',
        input.units,
        input.margin,
        new Date().toISOString(),
      );
    }
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const anon = getEnv().supabaseAnonKey;
    const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/place-partner-bond-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? anon}`, Apikey: anon },
      body: JSON.stringify({
        client_id: input.clientId, bond_id: input.bondId, units: input.units,
        margin: input.margin, notes: input.notes ?? '',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.order) throw new Error(body?.error || 'Could not place the order. Please try again.');
    return body.order as PartnerBondOrder;
  },

  /** Mint a shareable per-bond link at a per-bond margin (0..5%). Returns the token. */
  async createBondShare(bondId: string, margin: number): Promise<string> {
    // A token shaped like the real thing so the share sheet and its WhatsApp
    // message can be demonstrated. It resolves to nothing: resolve-bond-share
    // has no demo path, so opening the link shows "This offer is unavailable".
    if (isDemoSession()) {
      await new Promise((r) => setTimeout(r, 400));
      return `demo-${bondId}-${Math.round(margin * 100)}`;
    }
    const { data, error } = await supabase.rpc('nw_partner_create_bond_share', {
      p_bond_id: bondId as unknown as string, p_margin: margin,
    });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return String(data);
  },

  /** Bond orders this partner raised (RLS scopes to their own dsa_id), newest first. */
  async getMyBondOrders(): Promise<PartnerBondOrder[]> {
    if (isDemoSession()) return demoBondOrders();
    const { data, error } = await supabase
      .from('nw_bond_orders')
      .select('id, ref, bond_name, isin, units, price_per_100, amount, status, partner_markup_percent, created_at, client:nw_clients(full_name, client_code)')
      .order('created_at', { ascending: false });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return (data ?? []) as unknown as PartnerBondOrder[];
  },

  // --- Unlisted shares -------------------------------------------------------
  // The same four operations as bonds, priced per share. Kept as separate methods
  // rather than a product parameter because the row shapes genuinely differ (no
  // coupon, no face-value arithmetic) and a union type would push that branch
  // into every caller.

  /** Unlisted shares the partner may sell, at their cost + their own <=5% spread. */
  async getShares(): Promise<PartnerShare[]> {
    if (isDemoSession()) return demoShares();
    const { data, error } = await supabase.rpc('nw_partner_unlisted_shares');
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return (data ?? []) as PartnerShare[];
  },

  /** A single share for the partner detail page. null if not resolvable for this DSA. */
  async getShare(id: string): Promise<PartnerShare | null> {
    if (isDemoSession()) return demoShare(id);
    const { data, error } = await supabase.rpc('nw_partner_unlisted_share', { p_id: id as unknown as string });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    const rows = (data ?? []) as PartnerShare[];
    return rows[0] ?? null;
  },

  /** Set the partner's own share markup (0..5%). Server enforces the cap. */
  async setShareMarkup(percent: number): Promise<void> {
    if (isDemoSession()) { setDemoShareMarkup(percent); return; }
    const { error } = await supabase.rpc('nw_partner_set_share_markup', { p_percent: percent });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
  },

  /**
   * Place an unlisted-share order for one of the partner's clients, at the
   * partner's per-share price. The edge function re-derives the price server-side
   * and routes the order to the CLIENT'S RM.
   */
  async placeShareOrder(input: { clientId: string; shareId: string; qty: number; margin: number; notes?: string }): Promise<PartnerShareOrder> {
    if (isDemoSession()) {
      const share = demoShare(input.shareId);
      if (!share) throw new Error('Not available in the demo portal.');
      const client = demoClients.find((c) => c.client_id === input.clientId);
      await new Promise((r) => setTimeout(r, 500));
      return addDemoShareOrder(
        share,
        client?.full_name ?? 'SAMPLE CLIENT',
        client?.client_code ?? 'NW-DEMO-0000',
        input.qty,
        input.margin,
        new Date().toISOString(),
      );
    }
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const anon = getEnv().supabaseAnonKey;
    const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/place-partner-share-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? anon}`, Apikey: anon },
      body: JSON.stringify({
        client_id: input.clientId, share_id: input.shareId, qty: input.qty,
        margin: input.margin, notes: input.notes ?? '',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.order) throw new Error(body?.error || 'Could not place the order. Please try again.');
    return body.order as PartnerShareOrder;
  },

  /** Mint a shareable per-share link at a per-share margin (0..5%). Returns the token. */
  async createShareLink(shareId: string, margin: number): Promise<string> {
    if (isDemoSession()) {
      await new Promise((r) => setTimeout(r, 400));
      return `demo-${shareId}-${Math.round(margin * 100)}`;
    }
    const { data, error } = await supabase.rpc('nw_partner_create_share_link', {
      p_share_id: shareId as unknown as string, p_margin: margin,
    });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return String(data);
  },

  /** Share orders this partner raised (RLS scopes to their own dsa_id), newest first. */
  async getMyShareOrders(): Promise<PartnerShareOrder[]> {
    if (isDemoSession()) return demoShareOrders();
    const { data, error } = await supabase
      .from('nw_share_orders')
      .select('id, ref, company_name, isin, qty, price_per_share, amount, status, partner_markup_percent, created_at, client:nw_clients(full_name, client_code)')
      .order('created_at', { ascending: false });
    if (error) {
      if (isAccessRevoked(error.message)) throw new Error(PARTNER_ACCESS_REVOKED);
      throw error;
    }
    return (data ?? []) as unknown as PartnerShareOrder[];
  },
};

export type PartnerBondOrderStatus = 'submitted' | 'deal_sent' | 'accepted' | 'cancelled';

export interface PartnerBondOrder {
  id: string;
  ref: string;
  bond_name: string;
  isin: string;
  units: number;
  price_per_100: number;
  amount: number | null;
  status: PartnerBondOrderStatus;
  partner_markup_percent: number | null;
  created_at: string;
  client?: { full_name: string | null; client_code: string | null } | null;
}

export interface PartnerShareOrder {
  id: string;
  ref: string;
  company_name: string;
  isin: string;
  qty: number;
  price_per_share: number;
  amount: number | null;
  status: PartnerBondOrderStatus;
  partner_markup_percent: number | null;
  created_at: string;
  client?: { full_name: string | null; client_code: string | null } | null;
}
