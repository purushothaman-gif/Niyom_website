/**
 * ProfileService
 * -----------------------------------------------------------------------------
 * Read-only profile data beyond the client record itself — currently the
 * client's registered bank accounts (nw_client_bank_accounts). Personal / demat
 * / KYC fields already live on the NWClient carried by the snapshot.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWClientBankAccount } from '../../crm/types';

export const ProfileService = {
  async getBankAccounts(clientId: string): Promise<NWClientBankAccount[]> {
    const { data, error } = await supabase
      .from('nw_client_bank_accounts')
      .select('*')
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as NWClientBankAccount[]) ?? [];
  },
};

/** Mask all but the last 4 characters of an account number for on-screen privacy. */
export function maskAccount(value: string | null | undefined): string {
  if (!value) return '—';
  const s = String(value).replace(/\s+/g, '');
  if (s.length <= 4) return s;
  return `•••• ${s.slice(-4)}`;
}
