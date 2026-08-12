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
};
