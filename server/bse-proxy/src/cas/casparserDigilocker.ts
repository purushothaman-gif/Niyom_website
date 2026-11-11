/**
 * DigiLocker identity verification through CASParser.
 *
 *   POST /v1/kyc/digilocker/session       — start a consent session
 *   POST /v1/kyc/digilocker/result/{id}   — read the shared documents after consent
 *
 * An active flow: the investor signs in to DigiLocker and shares their PAN /
 * Aadhaar; we read the verified identity back. Off unless CASPARSER_API_KEY is
 * set.
 */
import type { ProxyConfig } from '../config.js';
import { CasError } from './db.js';

const BASE = 'https://api.casparser.in';
const TIMEOUT_MS = 65_000; // the result read can take up to ~60s

export const digilockerEnabled = (cfg: ProxyConfig): boolean => Boolean(cfg.casparserApiKey);

async function vendor(
  cfg: ProxyConfig,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!cfg.casparserApiKey) throw new CasError('Identity verification is not enabled.', 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let status = 0;
  let json: Record<string, unknown> = {};
  try {
    const res = await fetchImpl(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.casparserApiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = res.status;
    json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    console.error('[cas/digilocker] unreachable', path, err instanceof Error ? err.name : 'error');
    throw new CasError('We could not reach the verification service just now. Please try again.', 502);
  } finally {
    clearTimeout(timer);
  }
  if (status >= 200 && status < 300 && String(json.status ?? 'success').toLowerCase() !== 'failed') return json;
  console.error('[cas/digilocker] rejected', path, status, String(json.msg ?? json.message ?? '').slice(0, 200));
  throw new CasError('We could not complete the verification just now. Please try again.', 502);
}

/** Start a session; returns the authorization URL the investor opens. */
export async function startDigilockerSession(
  cfg: ProxyConfig,
  args: { redirectUrl: string; consentPurpose: string; state: string; documents?: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<{ sessionId: string; authorizationUrl: string }> {
  const json = await vendor(
    cfg,
    '/v1/kyc/digilocker/session',
    {
      consent: true,
      consent_purpose: args.consentPurpose,
      redirect_url: args.redirectUrl,
      documents: args.documents ?? ['pan', 'aadhaar'],
      state: args.state,
    },
    fetchImpl,
  );
  const sessionId = String(json.session_id ?? '');
  const authorizationUrl = String(json.authorization_url ?? '');
  if (!sessionId || !authorizationUrl) throw new CasError('The service did not start a session.', 502);
  return { sessionId, authorizationUrl };
}

export interface DigilockerResult {
  verified: boolean;
  name: string | null;
  dob: string | null;
  pan: string | null;
  aadhaarMasked: string | null;
  raw: Record<string, unknown>;
}

export function mapDigilockerResult(json: Record<string, unknown>): DigilockerResult {
  const identity = (json.identity as Record<string, unknown>) ?? {};
  const verified = (identity.verified as Record<string, unknown>) ?? {};
  const fetched = (json.fetched as Record<string, unknown>) ?? {};
  const fetchedPan = (fetched.pan as Record<string, unknown>) ?? {};
  const pan = (verified.pan as string) ?? (fetchedPan.pan as string) ?? null;
  const aadhaar = (verified.aadhaar as string) ?? null;
  const name = (identity.name as string) ?? null;
  return {
    // Verified when DigiLocker returned at least a confirmed PAN or Aadhaar.
    verified: Boolean(pan || aadhaar),
    name,
    dob: (identity.dob as string) ?? null,
    pan: pan ? pan.toUpperCase() : null,
    aadhaarMasked: aadhaar,
    raw: json,
  };
}

/** Read the shared documents after the investor consents. */
export async function readDigilockerResult(
  cfg: ProxyConfig,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DigilockerResult> {
  const json = await vendor(
    cfg,
    `/v1/kyc/digilocker/result/${encodeURIComponent(sessionId)}`,
    { fetch_documents: ['pan'] },
    fetchImpl,
  );
  return mapDigilockerResult(json);
}
