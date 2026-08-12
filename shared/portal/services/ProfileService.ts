/**
 * ProfileService
 * -----------------------------------------------------------------------------
 * Profile data beyond the client record itself — the client's registered bank
 * accounts (nw_client_bank_accounts), and their profile photo. Personal / demat
 * / KYC fields already live on the NWClient carried by the snapshot.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWClientBankAccount } from '../../crm/types';

const AVATAR_BUCKET = 'client-avatars';
/** Anything larger is a camera original; resizing belongs on the client. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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

  /**
   * Upload a profile photo and point the client record at it.
   *
   * The object path starts with the client's own code because that folder IS
   * the write scope in the bucket's RLS policy. Each upload gets a fresh
   * timestamped name rather than overwriting: a plain INSERT is all a client is
   * granted, and it also sidesteps CDN caching of a replaced image.
   */
  async uploadAvatar(
    clientId: string,
    clientCode: string,
    file: File,
  ): Promise<{ ok: boolean; url?: string; error?: string }> {
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      return { ok: false, error: 'Please choose a JPG, PNG or WEBP image.' };
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return { ok: false, error: 'That image is over 5 MB. Please choose a smaller one.' };
    }
    if (!clientCode) return { ok: false, error: 'Your account is still being set up.' };

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${clientCode}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) return { ok: false, error: upErr.message };

    const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const url = pub.publicUrl;

    const { error: dbErr } = await supabase
      .from('nw_clients')
      .update({ avatar_url: url })
      .eq('id', clientId);
    if (dbErr) return { ok: false, error: dbErr.message };

    return { ok: true, url };
  },

  /**
   * Drop the photo. The stored object is left in place — a client removing a
   * picture from their profile is not asking us to purge a file, and a failed
   * delete must not leave the record pointing at something that is gone.
   */
  async removeAvatar(clientId: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase
      .from('nw_clients')
      .update({ avatar_url: null })
      .eq('id', clientId);
    return error ? { ok: false, error: error.message } : { ok: true };
  },
};

/** Mask all but the last 4 characters of an account number for on-screen privacy. */
export function maskAccount(value: string | null | undefined): string {
  if (!value) return '—';
  const s = String(value).replace(/\s+/g, '');
  if (s.length <= 4) return s;
  return `•••• ${s.slice(-4)}`;
}
