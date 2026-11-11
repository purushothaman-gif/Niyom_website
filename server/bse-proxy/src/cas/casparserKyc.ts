/**
 * KYC + distributor checks through CASParser.
 *
 *   POST /v1/kyc/pan/status  — a PAN's KYC status across the five KRAs
 *   POST /v1/verify/mfd      — an AMFI ARN, with adverse-list screening
 *
 * Both run on the droplet because this is where the vendor key lives. The
 * vendor's own error text is logged but never forwarded — it is written for an
 * integrator and may name credits or plans a user should not see.
 *
 * Off unless CASPARSER_API_KEY is set.
 */
import type { ProxyConfig } from '../config.js';
import { CasError } from './db.js';

const BASE = 'https://api.casparser.in';
const KYC_TIMEOUT_MS = 65_000; // the CVL KRA portal can take up to ~60s
const ARN_TIMEOUT_MS = 25_000;

export const kycEnabled = (cfg: ProxyConfig): boolean => Boolean(cfg.casparserApiKey);

async function vendorPost(
  cfg: ProxyConfig,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!cfg.casparserApiKey) throw new CasError('This check is not enabled.', 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
    console.error('[cas/kyc] unreachable', path, err instanceof Error ? err.name : 'error');
    throw new CasError('We could not reach the verification service just now. Please try again.', 502);
  } finally {
    clearTimeout(timer);
  }
  if (status >= 200 && status < 300 && String(json.status ?? 'success').toLowerCase() !== 'failed') {
    return json;
  }
  console.error('[cas/kyc] rejected', path, status, String(json.msg ?? json.message ?? '').slice(0, 300));
  if (status === 402) throw new CasError('This check is temporarily unavailable. Please try later.', 502);
  if (status >= 400 && status < 500 && ![401, 403, 429].includes(status)) {
    throw new CasError('Those details were not accepted. Please check them and try again.', 400);
  }
  throw new CasError('We could not complete the check just now. Please try again.', 502);
}

/* ------------------------------------------------------------ KYC PAN status */

export interface KycStatus {
  /** Normalised enum: validated | registered | under_process | on_hold | rejected | legacy | not_available | not_checked | unknown */
  status: string;
  compliant: boolean;
  /** Which KRA holds the active record, e.g. 'cvl'. Null when none. */
  activeKra: string | null;
  registeredOn: string | null;
  lastUpdatedOn: string | null;
  /** The full per-KRA breakdown, verbatim, for the detail view. */
  kras: Record<string, unknown>;
}

export function mapKycStatus(json: Record<string, unknown>): KycStatus {
  return {
    status: String(json.kyc_status ?? 'unknown'),
    compliant: json.kyc_compliant === true,
    activeKra: (json.active_kra as string) ?? null,
    registeredOn: (json.registered_on as string) ?? null,
    lastUpdatedOn: (json.last_updated_on as string) ?? null,
    kras: (json.kras as Record<string, unknown>) ?? {},
  };
}

export async function panKycStatus(
  cfg: ProxyConfig,
  pan: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KycStatus> {
  const json = await vendorPost(cfg, '/v1/kyc/pan/status', { pan_no: pan }, KYC_TIMEOUT_MS, fetchImpl);
  return mapKycStatus(json);
}

/* -------------------------------------------------------------- ARN (AMFI) */

export interface ArnVerification {
  arn: string;
  /** True ONLY when the ARN is on the active register and not on an adverse list. */
  verified: boolean;
  /** ACTIVE | EXPIRED | SUSPENDED | TERMINATED | NOT_FOUND */
  registrationStatus: string;
  name: string | null;
  euin: string | null;
  validTill: string | null;
  /** True for a SUSPENDED/TERMINATED hit; the UI must warn, not just "not found". */
  negativeListHit: boolean;
  negativeList: Record<string, unknown> | null;
}

export function mapArn(json: Record<string, unknown>): ArnVerification {
  return {
    arn: String(json.arn ?? ''),
    verified: json.verified === true,
    registrationStatus: String(json.registration_status ?? 'NOT_FOUND'),
    name: (json.name as string) ?? null,
    euin: (json.euin as string) ?? null,
    validTill: (json.valid_till as string) ?? null,
    negativeListHit: json.negative_list_hit === true,
    negativeList: (json.negative_list as Record<string, unknown>) ?? null,
  };
}

export async function verifyArn(
  cfg: ProxyConfig,
  arn: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArnVerification> {
  const json = await vendorPost(cfg, '/v1/verify/mfd', { arn }, ARN_TIMEOUT_MS, fetchImpl);
  return mapArn(json);
}
