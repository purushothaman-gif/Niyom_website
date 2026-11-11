/**
 * Inbound-email import through CASParser.
 *
 *   POST   /v4/inbound-email             — create a forward-to address
 *   GET    /v4/inbound-email/{id}/files  — list files received (incremental)
 *   DELETE /v4/inbound-email/{id}        — remove the address
 *
 * A client forwards their CAS statement to the address; CASParser webhooks us,
 * and we pull the authoritative file list here with our key.
 */
import type { ProxyConfig } from '../config.js';
import { CasError } from './db.js';

const BASE = 'https://api.casparser.in';
const TIMEOUT_MS = 30_000;

export const inboundEnabled = (cfg: ProxyConfig): boolean => Boolean(cfg.casparserApiKey);

async function vendor(
  cfg: ProxyConfig,
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!cfg.casparserApiKey) throw new CasError('Email import is not enabled.', 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.casparserApiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  } catch (err) {
    console.error('[cas/inbound] unreachable', path, err instanceof Error ? err.name : 'error');
    throw new CasError('We could not reach the email service just now. Please try again.', 502);
  } finally {
    clearTimeout(timer);
  }
}

function ok(path: string, status: number, json: Record<string, unknown>): void {
  if (status >= 200 && status < 300 && String(json.status ?? 'success').toLowerCase() !== 'failed') return;
  console.error('[cas/inbound] rejected', path, status, String(json.msg ?? json.message ?? '').slice(0, 200));
  throw new CasError('We could not set that up just now. Please try again.', 502);
}

/** Create (or re-create) the client's forward-to address. */
export async function createInboundEmail(
  cfg: ProxyConfig,
  args: { reference: string; callbackUrl: string; allowedSources?: string[] },
  fetchImpl: typeof fetch = fetch,
): Promise<{ inboundEmailId: string; address: string }> {
  const body: Record<string, unknown> = { reference: args.reference, callback_url: args.callbackUrl };
  if (args.allowedSources?.length) body.allowed_sources = args.allowedSources;
  const { status, json } = await vendor(cfg, 'POST', '/v4/inbound-email', body, fetchImpl);
  ok('/v4/inbound-email', status, json);
  const inboundEmailId = String(json.inbound_email_id ?? '');
  const address = String(json.email ?? '');
  if (!inboundEmailId || !address) throw new CasError('The service did not return an address.', 502);
  return { inboundEmailId, address };
}

export interface InboundFile {
  messageId: string;
  filename: string;
  casType: string; // cdsl | nsdl | cams | kfintech
  url: string;
}

/** List files received since the last cursor. Authoritative — our key, not the webhook body. */
export async function listInboundFiles(
  cfg: ProxyConfig,
  inboundEmailId: string,
  since: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ files: InboundFile[]; cursor: string | null }> {
  if (!cfg.casparserApiKey) throw new CasError('Email import is not enabled.', 503);
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${BASE}/v4/inbound-email/${encodeURIComponent(inboundEmailId)}/files${qs}`, {
      headers: { 'x-api-key': cfg.casparserApiKey },
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    ok('/v4/inbound-email/files', res.status, json);
    const files = (Array.isArray(json.files) ? json.files : []).map((f) => {
      const r = f as Record<string, unknown>;
      return {
        messageId: String(r.message_id ?? ''),
        filename: String(r.filename ?? ''),
        casType: String(r.cas_type ?? '').toLowerCase(),
        url: String(r.url ?? ''),
      } satisfies InboundFile;
    });
    return { files, cursor: (json.cursor as string) ?? null };
  } finally {
    clearTimeout(timer);
  }
}

export async function deleteInboundEmail(
  cfg: ProxyConfig,
  inboundEmailId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await vendor(cfg, 'DELETE', `/v4/inbound-email/${encodeURIComponent(inboundEmailId)}`, null, fetchImpl).catch(
    () => undefined,
  );
}
