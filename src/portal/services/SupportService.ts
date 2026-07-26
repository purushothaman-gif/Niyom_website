/**
 * SupportService
 * -----------------------------------------------------------------------------
 * Client-portal support tickets ("Raise a Ticket"). A client creates a ticket
 * against their own client record; their relationship employee / admins work it
 * from the CRM. All calls run through `clientSupabase` so RLS resolves the
 * client via client_auth_user_id = auth.uid().
 */
import { clientSupabase as supabase } from '../../lib/supabase';

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
  /** Raise a new ticket for the signed-in client. Returns the created row. */
  async createTicket(clientId: string, input: NewTicketInput): Promise<SupportTicket> {
    const { data, error } = await supabase
      .from('nw_support_tickets')
      .insert({
        client_id: clientId,
        category: input.category,
        subject: input.subject.trim(),
        message: input.message.trim(),
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as SupportTicket;
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
