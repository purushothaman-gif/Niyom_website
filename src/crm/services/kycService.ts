/**
 * CRM-side KYC + ARN checks.
 *
 * Calls the droplet proxy's /cas/kyc routes with the staff member's own
 * Supabase session, the same way the MF Admin console reaches the proxy. The
 * vendor key and all vendor logic stay on the droplet; this is a thin caller.
 */
import { supabase } from '../../lib/supabase';
import { bseProxyBaseUrl } from '../../../shared/platform/env';

const proxyBaseUrl = bseProxyBaseUrl;

export interface KycResult {
  status: string;
  compliant: boolean;
  activeKra: string | null;
  registeredOn: string | null;
  lastUpdatedOn: string | null;
  kras: Record<string, { status?: string; remarks?: string | null } & Record<string, unknown>>;
}

export interface ArnResult {
  arn: string;
  verified: boolean;
  registrationStatus: string;
  name: string | null;
  euin: string | null;
  validTill: string | null;
  negativeListHit: boolean;
  negativeList: { type?: string; since?: string } | null;
}

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

async function post<T>(path: string, body: Record<string, unknown>): Promise<Res<T>> {
  const base = proxyBaseUrl();
  if (!base) return { ok: false, error: 'Verification is not configured here.' };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'Your session has expired. Please sign in again.' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (json.error as string) || 'The check could not be completed.' };
    return { ok: true, data: json as unknown as T };
  } catch {
    return { ok: false, error: 'We could not reach the verification service.' };
  }
}

async function get<T>(path: string): Promise<Res<T>> {
  const base = proxyBaseUrl();
  if (!base) return { ok: false, error: 'Verification is not configured here.' };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'Your session has expired. Please sign in again.' };
  try {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (json.error as string) || 'The check could not be completed.' };
    return { ok: true, data: json as unknown as T };
  } catch {
    return { ok: false, error: 'We could not reach the verification service.' };
  }
}

export interface DigilockerStatus {
  status: string; // none | pending | verified | failed
  name?: string | null;
  pan?: string | null;
  aadhaarMasked?: string | null;
  nameMatch?: boolean | null;
  verifiedAt?: string | null;
}

export const KycService = {
  /** Whether KYC/ARN checks are available (the server has a vendor key). */
  async enabled(): Promise<boolean> {
    const base = proxyBaseUrl();
    if (!base) return false;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    try {
      const res = await fetch(`${base}/cas/kyc/mode`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      return ((await res.json()) as { enabled?: boolean }).enabled === true;
    } catch {
      return false;
    }
  },

  /** Run the KRA KYC check for a client; the server caches it on the record. */
  checkPan(clientId: string): Promise<Res<KycResult>> {
    return post<KycResult>('/cas/kyc/pan-status', { clientId });
  },

  /** Verify an AMFI ARN before onboarding a partner. Stateless. */
  verifyArn(arn: string): Promise<Res<ArnResult>> {
    return post<ArnResult>('/cas/kyc/arn-verify', { arn });
  },

  /** Whether DigiLocker verification is available. */
  async digilockerEnabled(): Promise<boolean> {
    const r = await get<{ enabled?: boolean }>('/cas/digilocker/mode');
    return r.ok && r.data.enabled === true;
  },

  /** Start a DigiLocker session; returns a link to send the client. */
  startDigilocker(clientId: string): Promise<Res<{ authorizationUrl: string }>> {
    return post<{ authorizationUrl: string }>('/cas/digilocker/start', { clientId });
  },

  /** The client's latest DigiLocker verification. */
  async digilockerStatus(clientId: string): Promise<DigilockerStatus> {
    const r = await get<DigilockerStatus>(`/cas/digilocker/status?clientId=${encodeURIComponent(clientId)}`);
    return r.ok ? r.data : { status: 'none' };
  },
};
