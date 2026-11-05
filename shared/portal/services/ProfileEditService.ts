/**
 * Client profile self-service — contact details, nominees, bank accounts.
 *
 * Every write goes through the client-profile-update edge function, which
 * identifies the client from their own session (never from the body), checks
 * an email OTP, applies the change, logs it and alerts the RM. Reads use the
 * client's own RLS (own rows only).
 *
 * The sample portal has no session: it simulates success and saves nothing.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { edgeFunctionErrorMessage } from '../../lib/edgeFunctionError';
import { isDemoClientSession } from '../demo/demoClient';

export interface Nominee {
  id?: string;
  full_name: string;
  relationship: string;
  dob: string | null;
  share_percent: number;
  guardian_name: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
}

export type ProfileChange =
  | { kind: 'contact'; phone?: string; email?: string; address?: string; city?: string; state?: string; pincode?: string }
  | { kind: 'nominees'; nominees: Nominee[] }
  | { kind: 'bank_add'; account_number: string; ifsc: string; holder_name?: string; label?: string; make_primary?: boolean }
  | { kind: 'bank_delete'; id: string }
  | { kind: 'bank_primary'; id: string };

export type Result<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<Result<T>> {
  const { data, error } = await supabase.functions.invoke('client-profile-update', { body });
  if (error) {
    return { ok: false, error: await edgeFunctionErrorMessage(error, null, fallback, { allowLibraryMessage: false }) };
  }
  return { ok: true, ...(data as T) };
}

export const ProfileEditService = {
  async requestOtp(): Promise<Result<{ email_masked?: string }>> {
    if (isDemoClientSession()) return { ok: true, email_masked: 'sample portal — use any 6 digits' };
    return call({ action: 'request_otp' }, 'We could not send the code. Please try again.');
  },

  async apply(otp: string, change: ProfileChange): Promise<Result> {
    if (isDemoClientSession()) {
      await new Promise((r) => setTimeout(r, 600));
      return /^\d{6}$/.test(otp) ? { ok: true } : { ok: false, error: 'Enter the 6-digit code.' };
    }
    return call({ action: 'apply', otp, change }, 'We could not save that change. Please try again.');
  },

  async getNominees(clientId: string): Promise<Nominee[]> {
    if (isDemoClientSession()) return [];
    const { data, error } = await supabase
      .from('nw_client_nominees')
      .select('id, full_name, relationship, dob, share_percent, guardian_name, mobile, email, address')
      .eq('client_id', clientId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map((n) => ({ ...n, share_percent: Number(n.share_percent) })) as Nominee[];
  },
};
