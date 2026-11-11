/**
 * Import a mutual-fund CAS through OUR OWN reconciling parser.
 *
 * Demat eCAS is parsed by CASParser (demat_* tables). Mutual funds are
 * different: they must go through the cas-import edge function, which parses
 * with our parser AND reconciles against the statement's own totals before the
 * figures are shown. The portal's manual upload already does this; this is the
 * server-initiated path for statements the email sweep pulls.
 *
 * The droplet downloads the PDF (presigned URL from the inbox/inbound feed),
 * then calls cas-import with the service-role key as the bearer — a branch the
 * function accepts as a trusted server caller, taking the clientId from the body.
 *
 * Password note: this passes the client's PAN, which unlocks a CAMS statement
 * (and any CAS our own generator requested, since that uses the PAN). A
 * KFintech statement with a user-chosen password will not unlock here and comes
 * back needing manual import — the summary says so rather than failing silently.
 */
import type { ProxyConfig } from '../config.js';

const MAX_BYTES = 18 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const PARSE_TIMEOUT_MS = 90_000;

export interface MfImportResult {
  ok: boolean;
  status?: string; // reconciled | mismatch | failed
  duplicate?: boolean;
  reason?: string; // download_failed | too_large | locked | not_reconciled | unreachable | not_configured
}

export async function importMfFromUrl(
  cfg: ProxyConfig,
  clientId: string,
  url: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MfImportResult> {
  if (!cfg.supabaseServiceRoleKey) return { ok: false, reason: 'not_configured' };

  let bytes: ArrayBuffer;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!r.ok) return { ok: false, reason: 'download_failed' };
    bytes = await r.arrayBuffer();
  } catch {
    return { ok: false, reason: 'download_failed' };
  }
  if (bytes.byteLength > MAX_BYTES) return { ok: false, reason: 'too_large' };
  const fileBase64 = Buffer.from(bytes).toString('base64');

  let status = 0;
  let body: Record<string, unknown> = {};
  try {
    const res = await fetchImpl(`${cfg.supabaseUrl}/functions/v1/cas-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
        apikey: cfg.supabaseServiceRoleKey,
      },
      body: JSON.stringify({ fileBase64, password, clientId }),
      signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    });
    status = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (status < 200 || status >= 300) {
    // A wrong password surfaces as a parse error; treat it as "needs manual".
    const msg = String(body.error ?? '').toLowerCase();
    return { ok: false, reason: /password|locked|encrypt/.test(msg) ? 'locked' : 'parse_failed' };
  }

  const resultStatus = String(body.status ?? '');
  // Only a reconciled import is authoritative; a mismatch is kept server-side
  // for diagnosis but not counted as imported.
  return {
    ok: resultStatus === 'reconciled',
    status: resultStatus,
    duplicate: body.duplicate === true,
    reason: resultStatus === 'reconciled' ? undefined : 'not_reconciled',
  };
}
