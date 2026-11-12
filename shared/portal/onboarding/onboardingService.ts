/**
 * OnboardingService — client-authenticated calls for the in-portal KYC wizard.
 * Edge functions run public (verify_jwt=false) but require the client's own
 * bearer token and verify record ownership server-side.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { getEnv, bseProxyBaseUrl } from '../../platform/env';
import { compressImageFile } from '../../lib/compressImage';

/** Bearer headers for a droplet (BSE-proxy) call made as the signed-in client. */
async function proxyAuthHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

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

  // ── Step 2 (preferred): verify identity via DigiLocker ──────────────────
  // DigiLocker pulls PAN + name (+ DOB) straight from the government source, so
  // it replaces the Cashfree PAN step where it is available. The flow: start a
  // session, the client consents in a popup, we poll digilocker_sessions (RLS
  // own-read) until it is verified, then promote the result into pan fields.

  /** Is DigiLocker verification available (server has a vendor key)? */
  async digilockerEnabled(): Promise<boolean> {
    const baseUrl = bseProxyBaseUrl();
    if (!baseUrl) return false;
    const headers = await proxyAuthHeaders();
    if (!headers) return false;
    try {
      const res = await fetch(`${baseUrl}/cas/digilocker/mode`, { headers });
      if (!res.ok) return false;
      const body = (await res.json()) as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
  },

  /** Begin a verification; returns the DigiLocker URL for the client to open. */
  async startDigilocker(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const baseUrl = bseProxyBaseUrl();
    if (!baseUrl) return { ok: false, error: 'Identity verification is not available here yet.' };
    const headers = await proxyAuthHeaders();
    if (!headers) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    try {
      const res = await fetch(`${baseUrl}/cas/digilocker/start`, { method: 'POST', headers, body: '{}' });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !body.authorizationUrl) {
        return { ok: false, error: (body.error as string) || 'Could not start verification.' };
      }
      return { ok: true, url: String(body.authorizationUrl) };
    } catch {
      return { ok: false, error: 'Could not reach the server. Please check your connection.' };
    }
  },

  /** The client's latest DigiLocker session state (read under their own RLS). */
  async digilockerLatest(
    clientId: string,
  ): Promise<{ status: string; pan: string | null; name: string | null } | null> {
    const { data } = await supabase
      .from('digilocker_sessions')
      .select('status, dl_pan, dl_name')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return { status: data.status as string, pan: (data.dl_pan as string) ?? null, name: (data.dl_name as string) ?? null };
  },

  /** Promote a verified DigiLocker identity into the client's PAN fields. */
  async applyDigilocker(clientId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    const { ok, data } = await authedFn('public-digilocker-apply', { client_id: clientId });
    return ok ? { ok: true, name: data.name_as_per_pan } : { ok: false, error: data.error };
  },

  /** Step 3 — upload a KYC document to storage, then record it server-side. */
  async uploadDoc(
    clientId: string,
    clientCode: string,
    docType: 'PAN' | 'CML' | 'BANK',
    original: File,
  ): Promise<{ ok: boolean; error?: string }> {
    const file = await compressImageFile(original);
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

  /**
   * Investor profile for mutual funds — the FATCA declaration and nomination.
   * Validated and stored server-side (the columns are closed to the client's
   * own session), which is also what marks the profile complete.
   */
  async saveInvestorProfile(
    clientId: string,
    profile: Record<string, unknown>,
    nomination: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    const { ok, data } = await authedFn('public-onboard-save-profile', { client_id: clientId, profile, nomination });
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
