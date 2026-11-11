/**
 * Asking for a CAS mailback through CASParser's Generator API.
 *
 * ## What this is, and where the line now sits
 *
 * `requests.ts` used to contain no code that could ask a registrar for
 * anything, and said so. This module is the deliberate exception (2026-11-11):
 * with the client's explicit, separately-worded consent (policy v2), we hand
 * their email, PAN and a one-time file password to a vendor whose product is
 * placing that request. We still never touch camsonline.com ourselves, never
 * see the statement, and the registrar still emails it only to the investor.
 *
 * It is OFF unless `CASPARSER_API_KEY` is set, and even then a request is only
 * placed when the caller says the client was shown the v2 wording. Everything
 * else falls back to the guided form, which stays fully working.
 *
 * ## What the vendor does not let us choose
 *
 * The API always requests a Detailed statement and has no folio-listing
 * option, so `cas_requests.folio_listing` is recorded as `vendor_default` for
 * these rows rather than claiming a listing we did not set.
 *
 * The password is passed through and never stored or logged — here or in the
 * route. It exists so the client can open the PDF, and the browser keeps it for
 * that; this box has no use for it after the call returns.
 */
import type { ProxyConfig } from '../config.js';
import { CasError } from './db.js';

const ENDPOINT = 'https://api.casparser.in/v4/generate';
const TIMEOUT_MS = 20_000;

export interface MailbackInput {
  email: string;
  /** Optional on the vendor's side too; omitted when we hold none. */
  pan?: string | null;
  /** ISO dates, YYYY-MM-DD. */
  fromDate: string;
  toDate: string;
  password: string;
}

/**
 * The rule both registrars accept: CAMS's portal rule (8–15, starts with a
 * letter, upper + digit + one of @#$*_) is the stricter of the two the vendor
 * documents, so a password that passes it is safe whichever authority is used.
 * Mirrors shared/portal/services/casPassword.ts, which generates them.
 */
export function isAcceptablePassword(p: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9@#$*_]{7,14}$/.test(p) &&
    /[A-Z]/.test(p) &&
    /[0-9]/.test(p) &&
    /[@#$*_]/.test(p)
  );
}

export const mailbackEnabled = (cfg: ProxyConfig): boolean => Boolean(cfg.casparserApiKey);

/** The JSON body, separated out so the field names are pinned by a test. */
export function buildMailbackBody(
  cfg: Pick<ProxyConfig, 'casparserAuthority'>,
  input: MailbackInput,
): Record<string, string> {
  const pan = (input.pan ?? '').trim().toUpperCase();
  return {
    email: input.email,
    ...(/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? { pan_no: pan } : {}),
    from_date: input.fromDate,
    to_date: input.toDate,
    password: input.password,
    cas_authority: cfg.casparserAuthority,
  };
}

/**
 * Place the request. Resolves on success; throws a CasError whose message is
 * safe to show a client otherwise.
 *
 * The vendor's own error text is logged for us and NOT forwarded: it is written
 * for an integrator, and may name things (credits, plans, keys) a client should
 * never see.
 */
export async function requestCasMailback(
  cfg: ProxyConfig,
  input: MailbackInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!cfg.casparserApiKey) throw new CasError('Automatic requests are not enabled.', 503);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let status = 0;
  let body: Record<string, unknown> = {};
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.casparserApiKey },
      body: JSON.stringify(buildMailbackBody(cfg, input)),
      signal: ctrl.signal,
    });
    status = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    console.error('[cas/generator] unreachable', err instanceof Error ? err.name : 'error');
    throw new CasError(
      'We could not reach the statement service just now. Please try again in a minute.',
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  if (status >= 200 && status < 300 && String(body.status ?? '').toLowerCase() === 'success') {
    return;
  }

  // Never the request body — it carries the password.
  console.error('[cas/generator] rejected', status, String(body.msg ?? body.message ?? '').slice(0, 300));

  // 4xx other than auth/quota is almost always the input: an email the
  // registrars do not hold, or a date they refuse.
  if (status >= 400 && status < 500 && ![401, 402, 403, 429].includes(status)) {
    throw new CasError(
      'The registrar did not accept this request. Please check that this is the email address your mutual funds are registered under.',
      400,
    );
  }
  throw new CasError(
    'We could not place the request automatically just now. Please try again, or request the statement on the registrar’s website.',
    502,
  );
}
