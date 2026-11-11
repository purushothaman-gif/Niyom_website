/**
 * Email inbox import through CASParser.
 *
 *   POST /v4/inbox/connect     — start OAuth, returns the provider's consent URL
 *   POST /v4/inbox/cas         — list CAS files in the connected mailbox (URLs)
 *   POST /v4/inbox/disconnect  — revoke the connection
 *
 * The inbox_token returned on the OAuth callback is a long-lived credential and
 * is held only on the droplet (inbox_connections, service role). This module is
 * the thin vendor wrapper; inbox.ts does the storage and client association.
 */
import type { ProxyConfig } from '../config.js';
import { CasError } from './db.js';

const BASE = 'https://api.casparser.in';
const TIMEOUT_MS = 30_000;

export const inboxEnabled = (cfg: ProxyConfig): boolean => Boolean(cfg.casparserApiKey);

async function vendor(
  cfg: ProxyConfig,
  path: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!cfg.casparserApiKey) throw new CasError('Email import is not enabled.', 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.casparserApiKey, ...extraHeaders },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  } catch (err) {
    console.error('[cas/inbox] unreachable', path, err instanceof Error ? err.name : 'error');
    throw new CasError('We could not reach the email service just now. Please try again.', 502);
  } finally {
    clearTimeout(timer);
  }
}

function ensureOk(path: string, status: number, json: Record<string, unknown>): void {
  if (status >= 200 && status < 300 && String(json.status ?? 'success').toLowerCase() !== 'failed') return;
  console.error('[cas/inbox] rejected', path, status, String(json.msg ?? json.message ?? '').slice(0, 200));
  if (status === 402) throw new CasError('Email import is temporarily unavailable. Please try later.', 502);
  throw new CasError('We could not complete that just now. Please try again.', 502);
}

/** Start OAuth. `state` is round-tripped back to us on the callback. */
export async function inboxConnect(
  cfg: ProxyConfig,
  args: { redirectUri: string; state: string; provider: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ oauthUrl: string; provider: string }> {
  const { status, json } = await vendor(
    cfg,
    '/v4/inbox/connect',
    { redirect_uri: args.redirectUri, state: args.state, provider: args.provider },
    {},
    fetchImpl,
  );
  ensureOk('/v4/inbox/connect', status, json);
  const oauthUrl = String(json.oauth_url ?? '');
  if (!oauthUrl) throw new CasError('The email provider did not return a sign-in link.', 502);
  return { oauthUrl, provider: String(json.provider ?? args.provider) };
}

export interface InboxCasFile {
  messageId: string;
  filename: string;
  casType: string; // cdsl | nsdl | cams | kfintech
  senderEmail: string | null;
  url: string;
  messageDate: string | null;
}

/** List CAS files in the mailbox. Returns download URLs; parsing is separate. */
export async function inboxListCas(
  cfg: ProxyConfig,
  inboxToken: string,
  opts: { startDate?: string; endDate?: string; casTypes?: string[] } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ files: InboxCasFile[]; requiresReconnect: boolean }> {
  const body: Record<string, unknown> = {};
  if (opts.startDate) body.start_date = opts.startDate;
  if (opts.endDate) body.end_date = opts.endDate;
  if (opts.casTypes?.length) body.cas_types = opts.casTypes;
  const { status, json } = await vendor(cfg, '/v4/inbox/cas', body, { 'x-inbox-token': inboxToken }, fetchImpl);
  if (status === 401 || json.requires_reconnect === true) {
    return { files: [], requiresReconnect: true };
  }
  ensureOk('/v4/inbox/cas', status, json);
  const files = (Array.isArray(json.files) ? json.files : []).map((f) => {
    const r = f as Record<string, unknown>;
    return {
      messageId: String(r.message_id ?? ''),
      filename: String(r.filename ?? ''),
      casType: String(r.cas_type ?? '').toLowerCase(),
      senderEmail: (r.sender_email as string) ?? null,
      url: String(r.url ?? ''),
      messageDate: (r.message_date as string) ?? null,
    } satisfies InboxCasFile;
  });
  return { files, requiresReconnect: false };
}

export async function inboxDisconnect(
  cfg: ProxyConfig,
  inboxToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // Best-effort: even if the vendor call fails we still mark the row disconnected.
  await vendor(cfg, '/v4/inbox/disconnect', {}, { 'x-inbox-token': inboxToken }, fetchImpl).catch(() => undefined);
}
