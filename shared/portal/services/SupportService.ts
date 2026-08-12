/**
 * SupportService
 * -----------------------------------------------------------------------------
 * Client-portal support tickets ("Raise a Ticket"). A client creates a ticket
 * against their own client record; their relationship employee / admins work it
 * from the CRM. All calls run through `clientSupabase` so RLS resolves the
 * client via client_auth_user_id = auth.uid().
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { getEnv } from '../../platform/env';

export type TicketCategory =
  | 'general'
  | 'transaction'
  | 'kyc'
  | 'bank'
  | 'technical'
  | 'feedback';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface SupportTicket {
  id: string;
  ref: string;
  client_id: string;
  category: TicketCategory;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_at: string;
  updated_at: string;
}

export interface NewTicketInput {
  category: TicketCategory;
  subject: string;
  message: string;
}

export const SupportService = {
  /**
   * Raise a new ticket for the signed-in client. Goes through the
   * `raise-support-ticket` edge function so the assigned RM is emailed
   * server-side (the function also inserts the row, firing the in-app CRM
   * alert). Returns the created row.
   */
  async createTicket(clientId: string, input: NewTicketInput): Promise<SupportTicket> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const anon = getEnv().supabaseAnonKey;
    const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/raise-support-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? anon}`,
        Apikey: anon,
      },
      body: JSON.stringify({
        client_id: clientId,
        category: input.category,
        subject: input.subject.trim(),
        message: input.message.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ticket) {
      throw new Error(body?.error || 'Could not raise your ticket. Please try again.');
    }
    return body.ticket as SupportTicket;
  },

  /** List the client's own tickets, newest first. */
  async listTickets(clientId: string): Promise<SupportTicket[]> {
    const { data, error } = await supabase
      .from('nw_support_tickets')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as SupportTicket[]) ?? [];
  },
};
