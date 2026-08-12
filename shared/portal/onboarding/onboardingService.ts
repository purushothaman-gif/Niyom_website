/**
 * OnboardingService — client-authenticated calls for the in-portal KYC wizard.
 * Edge functions run public (verify_jwt=false) but require the client's own
 * bearer token and verify record ownership server-side.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { getEnv } from '../../platform/env';

const BUCKET = 'crm-documents';

async function authedFn<T = any>(name: string, payload: unknown): Promise<{ ok: boolean; data: T }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch(`${getEnv().supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? getEnv().supabaseAnonKey}`,
      Apikey: getEnv().supabaseAnonKey,
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
    /*
     * The browser has a `File`; a phone has a picked URI it read into bytes.
     * Both end in the same upload, so this normalises and delegates.
     */
    return OnboardingService.uploadDocBytes(clientId, clientCode, docType, {
      name: file.name,
      size: file.size,
      mimeType: file.type,
      body: file,
    });
  },

  /**
   * The platform-neutral form. `body` is whatever Supabase storage accepts —
   * a `File` in a browser, an `ArrayBuffer` in React Native, which has neither
   * `File` nor `Blob` in a form the storage client can upload.
   */
  async uploadDocBytes(
    clientId: string,
    clientCode: string,
    docType: 'PAN' | 'CML' | 'BANK',
    file: { name: string; size: number; mimeType: string; body: File | ArrayBuffer },
  ): Promise<{ ok: boolean; error?: string }> {
    const ext = file.name.slice(file.name.lastIndexOf('.'));
    // Unique path (timestamp) → always a fresh object, so upsert is unnecessary.
    // upsert:true would additionally require UPDATE permission on storage.objects,
    // which onboarding clients don't have (that's employee/admin-only) — causing
    // a "new row violates row-level security policy" error. A plain INSERT is
    // covered by the "Authenticated users can upload to crm-documents" policy.
    const path = `clients/${clientCode}/ONBOARD_KYC/${docType}_${Date.now()}${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file.body, { upsert: false, contentType: file.mimeType });
    if (upErr) return { ok: false, error: upErr.message };

    const { ok, data } = await authedFn('public-onboard-record-doc', {
      client_id: clientId,
      document_type: docType,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.mimeType,
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

  /**
   * Post-onboarding — an active client activates Bonds / Unlisted Shares by
   * supplying their demat (BO ID) + DP name. The CML must be uploaded first
   * (via uploadDoc('CML', ...)); this records the products and notifies the RM.
   */
  async activateProducts(
    clientId: string,
    products: string[],
    dematAccount: string,
    dpName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const { ok, data } = await authedFn('public-request-product-activation', {
      client_id: clientId,
      products,
      demat_account: dematAccount,
      dp_name: dpName,
    });
    return ok ? { ok: true } : { ok: false, error: data.error };
  },
};
