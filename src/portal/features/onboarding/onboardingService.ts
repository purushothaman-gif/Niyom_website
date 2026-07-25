/**
 * OnboardingService — client-authenticated calls for the in-portal KYC wizard.
 * Edge functions run public (verify_jwt=false) but require the client's own
 * bearer token and verify record ownership server-side.
 */
import { supabase } from '../../../lib/supabase';

const BUCKET = 'crm-documents';

async function authedFn<T = any>(name: string, payload: unknown): Promise<{ ok: boolean; data: T }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({} as T)) };
}

export const OnboardingService = {
  /** Step 2 — verify PAN and fetch name-as-per-PAN via Cashfree. */
  async verifyPan(clientId: string, pan: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    const { ok, data } = await authedFn('public-pan-verify', { client_id: clientId, pan });
    return ok ? { ok: true, name: data.name_as_per_pan } : { ok: false, error: data.error };
  },

  /** Step 3 — upload a KYC document to storage, then record it server-side. */
  async uploadDoc(
    clientId: string,
    clientCode: string,
    docType: 'PAN' | 'CML' | 'BANK',
    file: File,
  ): Promise<{ ok: boolean; error?: string }> {
    const ext = file.name.slice(file.name.lastIndexOf('.'));
    const path = `clients/${clientCode}/ONBOARD_KYC/${docType}_${Date.now()}${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (upErr) return { ok: false, error: upErr.message };

    const { ok, data } = await authedFn('public-onboard-record-doc', {
      client_id: clientId,
      document_type: docType,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type,
    });
    return ok ? { ok: true } : { ok: false, error: data.error };
  },

  /** Step 5 — submit KYC for review with chosen investment preferences. */
  async submit(clientId: string, prefs: string[]): Promise<{ ok: boolean; error?: string }> {
    const { ok, data } = await authedFn('public-onboard-submit', {
      client_id: clientId,
      investment_preferences: prefs,
    });
    return ok ? { ok: true } : { ok: false, error: data.error };
  },
};
