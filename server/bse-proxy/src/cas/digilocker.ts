/**
 * DigiLocker identity verification — an RM starts it, the client consents.
 *
 *   POST /cas/digilocker/start     → an authorization link to send the client
 *   GET  /cas/digilocker/callback  (PUBLIC) → DigiLocker returns here after consent
 *   GET  /cas/digilocker/status    → the latest verification for a client
 *
 * The callback carries no app session, so the client is tied back by the vendor
 * session id and the `state` we minted. The verified identity is written by the
 * service role only.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ProxyConfig } from '../config.js';
import { CasError, sbInsert, sbPatch, sbSelect } from './db.js';
import { digilockerEnabled, readDigilockerResult, startDigilockerSession } from './casparserDigilocker.js';

const CONSENT_PURPOSE = 'KYC verification for investment account onboarding at Niyom Wealth';

function callerClientId(req: Request, bodyClientId?: string): string {
  const caller = req.caller;
  if (!caller) throw new CasError('Caller not resolved.', 401);
  const id = caller.kind === 'staff' ? String(bodyClientId ?? '').trim() : (caller.clientId ?? '');
  if (!id) throw new CasError(caller.kind === 'staff' ? 'A client is required.' : 'Your record was not found.', 400);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CasError('That is not a valid client id.', 400);
  return id;
}

/** Names match when, ignoring case/punctuation/order, one is a subset of the other. */
function namesMatch(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  const toks = (s: string) => new Set(s.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((t) => t.length > 1));
  const x = toks(a);
  const y = toks(b);
  if (x.size === 0 || y.size === 0) return null;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((t) => big.has(t));
}

function portalOrigin(cfg: ProxyConfig): string {
  return cfg.allowedOrigins.find((o) => o.includes('niyomwealth.com')) ?? cfg.allowedOrigins[0] ?? 'https://www.niyomwealth.com';
}

function page(title: string, body: string, href: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0b1220;color:#e8edf5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:360px;text-align:center;padding:32px}h1{font-size:18px;margin:0 0 8px}p{color:#9fb0c7;font-size:14px;line-height:1.5}
a{display:inline-block;margin-top:20px;background:#c6a35a;color:#0b1220;text-decoration:none;font-weight:700;padding:10px 20px;border-radius:10px;font-size:14px}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p><a href="${href}">Return to Niyom</a></div></body></html>`;
}

/* ------------------------------ public signup ----------------------------- */

/** How long a signup session may be redeemed after it is started. */
export const SIGNUP_SESSION_TTL_MS = 60 * 60 * 1000;
/** Each session costs a vendor credit, and this route is anonymous. */
export const SIGNUP_MAX_PER_IP_PER_HOUR = 5;
const SIGNUP_DEFAULT_DAILY_CAP = 40;

/** The browser keeps the token; only its hash is stored. */
export function hashSignupToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A signup token is 64 hex characters (32 random bytes). */
export function isSignupToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
}

/**
 * Where the callback sends a signup visitor back to. Only an origin we already
 * allow for CORS is honoured, so the redirect can never be pointed elsewhere.
 */
export function signupReturnOrigin(cfg: Pick<ProxyConfig, 'allowedOrigins'>, requested: string | null | undefined): string {
  const origin = String(requested ?? '').trim().replace(/\/$/, '');
  if (origin && cfg.allowedOrigins.includes(origin)) return origin;
  return cfg.allowedOrigins.find((o) => o.includes('niyomwealth.com')) ?? cfg.allowedOrigins[0] ?? 'https://www.niyomwealth.com';
}

/** Whether a new anonymous session may start, given recent usage. */
export function signupThrottle(
  counts: { fromThisIpLastHour: number; allLastDay: number },
  dailyCap: number,
): 'ok' | 'ip_limit' | 'daily_cap' {
  if (counts.fromThisIpLastHour >= SIGNUP_MAX_PER_IP_PER_HOUR) return 'ip_limit';
  if (counts.allLastDay >= dailyCap) return 'daily_cap';
  return 'ok';
}

/** Show only the last four characters of a PAN. */
export function maskPan(pan: string | null): string | null {
  return pan && pan.length >= 4 ? `${'•'.repeat(pan.length - 4)}${pan.slice(-4)}` : null;
}

function signupDailyCap(): number {
  const n = Number(process.env.DIGILOCKER_SIGNUP_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 ? n : SIGNUP_DEFAULT_DAILY_CAP;
}

function requestIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

async function countSignupSessions(cfg: ProxyConfig, sinceIso: string, ip?: string): Promise<number> {
  const rows = await sbSelect<{ id: string }>(
    cfg,
    `digilocker_sessions?select=id&flow=eq.signup&created_at=gte.${encodeURIComponent(sinceIso)}` +
      (ip ? `&ip=eq.${encodeURIComponent(ip)}` : '') +
      `&limit=500`,
  );
  return rows.length;
}

interface SessionRow {
  id: string;
  client_id: string | null;
  session_id: string | null;
  flow: string;
  return_origin: string | null;
}

/**
 * PUBLIC — sits before the Supabase-JWT gate. Carries the DigiLocker consent
 * callback (no app session by nature) and the three anonymous signup routes:
 *
 *   GET  /cas/digilocker/public-mode    → is DigiLocker signup available
 *   POST /cas/digilocker/public-start   → begin a session for a visitor with no account
 *   POST /cas/digilocker/public-status  → that visitor's own result, by their token
 *
 * A signup visitor is identified only by a random token their browser holds;
 * the verified PAN and name stay server-side and are redeemed by
 * public-onboard-start, which reads them from the row rather than the request.
 */
export function digilockerCallbackRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.get('/public-mode', (_req: Request, res: Response) => res.json({ enabled: digilockerEnabled(cfg) }));

  router.post('/public-start', async (req: Request, res: Response) => {
    try {
      if (!digilockerEnabled(cfg)) return res.status(503).json({ error: 'DigiLocker verification is not available right now.' });

      const ip = requestIp(req);
      const now = Date.now();
      const verdict = signupThrottle(
        {
          fromThisIpLastHour: await countSignupSessions(cfg, new Date(now - 60 * 60 * 1000).toISOString(), ip),
          allLastDay: await countSignupSessions(cfg, new Date(now - 24 * 60 * 60 * 1000).toISOString()),
        },
        signupDailyCap(),
      );
      if (verdict === 'ip_limit') {
        return res.status(429).json({ error: 'Too many attempts. Please try again in a little while, or enter your PAN instead.' });
      }
      if (verdict === 'daily_cap') {
        console.error('[cas/digilocker] signup daily cap reached');
        return res.status(503).json({ error: 'DigiLocker verification is not available right now. Please enter your PAN instead.' });
      }

      const token = randomBytes(32).toString('hex');
      const state = randomUUID();
      const { sessionId, authorizationUrl } = await startDigilockerSession(cfg, {
        redirectUrl: `${cfg.publicBaseUrl ?? 'https://api.niyomwealth.com'}/cas/digilocker/callback`,
        consentPurpose: CONSENT_PURPOSE,
        state,
      });

      await sbInsert(cfg, 'digilocker_sessions', [
        {
          id: randomUUID(),
          client_id: null,
          flow: 'signup',
          session_id: sessionId,
          state,
          status: 'pending',
          signup_token_hash: hashSignupToken(token),
          expires_at: new Date(now + SIGNUP_SESSION_TTL_MS).toISOString(),
          ip,
          return_origin: signupReturnOrigin(cfg, req.headers.origin),
        },
      ]);
      res.json({ authorizationUrl, token });
    } catch (err) {
      if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
      console.error('[cas/digilocker] public-start unexpected', err);
      res.status(500).json({ error: 'Could not start DigiLocker verification. Please try again.' });
    }
  });

  router.post('/public-status', async (req: Request, res: Response) => {
    try {
      const token = (req.body as { token?: unknown })?.token;
      if (!isSignupToken(token)) return res.status(400).json({ error: 'Invalid request.' });

      const [row] = await sbSelect<{
        status: string;
        dl_name: string | null;
        dl_pan: string | null;
        expires_at: string | null;
        consumed_at: string | null;
      }>(
        cfg,
        `digilocker_sessions?select=status,dl_name,dl_pan,expires_at,consumed_at&flow=eq.signup` +
          `&signup_token_hash=eq.${hashSignupToken(token)}&limit=1`,
      );
      if (!row) return res.json({ status: 'none' });
      if (row.consumed_at || (row.expires_at && Date.parse(row.expires_at) < Date.now())) return res.json({ status: 'expired' });
      if (row.status !== 'verified') return res.json({ status: row.status });

      // Same question public-onboard-pan-verify answers on the manual path, so
      // the visitor is sent to sign in rather than into a form that will fail.
      const existing = row.dl_pan
        ? await sbSelect<{ id: string }>(cfg, `nw_clients?select=id&pan=eq.${encodeURIComponent(row.dl_pan)}&limit=1`)
        : [];
      res.json({
        status: 'verified',
        name: row.dl_name,
        panMasked: maskPan(row.dl_pan),
        alreadyRegistered: existing.length > 0,
      });
    } catch (err) {
      if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
      console.error('[cas/digilocker] public-status unexpected', err);
      res.status(500).json({ error: 'Could not check the verification. Please try again.' });
    }
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const back = portalOrigin(cfg);
    // A signup visitor goes straight back to the signup page, which reads the
    // outcome with its token; nothing about the result travels in the URL.
    let signupBack: string | null = null;
    try {
      const sessionId = String(req.query.id ?? '');
      const state = String(req.query.state ?? '');
      const success = String(req.query.success ?? '') === 'true';
      if (!sessionId && !state) return res.status(400).send(page('Something went wrong', 'That link was invalid.', back));

      const [row] = await sbSelect<SessionRow>(
        cfg,
        `digilocker_sessions?select=id,client_id,session_id,flow,return_origin&` +
          (sessionId ? `session_id=eq.${encodeURIComponent(sessionId)}` : `state=eq.${encodeURIComponent(state)}`) +
          `&limit=1`,
      );
      if (!row) return res.status(404).send(page('Link expired', 'This verification link has expired.', back));
      const isSignup = row.flow === 'signup';
      if (isSignup) signupBack = `${signupReturnOrigin(cfg, row.return_origin)}/onboarding?dl=1`;

      if (!success) {
        await sbPatch(cfg, `digilocker_sessions?id=eq.${row.id}`, {
          status: 'failed',
          error: String(req.query.error ?? 'consent_declined'),
          state: null,
        }).catch(() => undefined);
        if (signupBack) return res.redirect(302, signupBack);
        return res.send(page('Not verified', 'The verification was not completed. You can try again anytime.', back));
      }

      const result = await readDigilockerResult(cfg, sessionId || row.session_id || '');
      const [client] = row.client_id
        ? await sbSelect<{ full_name: string | null }>(
            cfg,
            `nw_clients?select=full_name&id=eq.${encodeURIComponent(row.client_id)}&limit=1`,
          )
        : [];
      // Signup creates the account from this row, so it needs both the PAN and
      // the name; an Aadhaar-only share is enough for an existing client's
      // identity check but not to open an account.
      const verified = isSignup ? Boolean(result.pan && result.name) : result.verified;
      await sbPatch(cfg, `digilocker_sessions?id=eq.${row.id}`, {
        status: verified ? 'verified' : 'failed',
        error: verified ? null : isSignup && result.verified ? 'pan_not_shared' : null,
        dl_name: result.name,
        dl_dob: result.dob,
        dl_pan: result.pan,
        dl_aadhaar_masked: result.aadhaarMasked,
        name_match: namesMatch(result.name, client?.full_name ?? null),
        result: result.raw,
        verified_at: verified ? new Date().toISOString() : null,
        state: null,
      });
      if (signupBack) return res.redirect(302, signupBack);
      res.send(page('Identity verified', 'Thank you — your documents were shared successfully. You can close this tab.', back));
    } catch {
      if (signupBack) return res.redirect(302, signupBack);
      res.status(500).send(page('Something went wrong', 'Please try the verification again in a moment.', back));
    }
  });
  return router;
}

/** Staff/own-client authenticated actions. */
export function digilockerRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.get('/mode', (_req: Request, res: Response) => res.json({ enabled: digilockerEnabled(cfg) }));

  /** Start a verification; returns the link to send the client. */
  router.post('/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!digilockerEnabled(cfg)) throw new CasError('Identity verification is not enabled yet.', 503);
      const clientId = callerClientId(req, (req.body as { clientId?: string })?.clientId);
      const state = randomUUID();

      const { sessionId, authorizationUrl } = await startDigilockerSession(cfg, {
        redirectUrl: `${cfg.publicBaseUrl ?? 'https://api.niyomwealth.com'}/cas/digilocker/callback`,
        consentPurpose: CONSENT_PURPOSE,
        state,
      });

      await sbInsert(cfg, 'digilocker_sessions', [
        {
          id: randomUUID(),
          client_id: clientId,
          session_id: sessionId,
          state,
          status: 'pending',
          created_by: req.caller?.kind === 'staff' ? (req.caller.employeeId ?? null) : null,
        },
      ]);
      res.json({ authorizationUrl });
    } catch (err) {
      next(err);
    }
  });

  /** The latest verification for a client. */
  router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = callerClientId(req, String(req.query.clientId ?? ''));
      const [row] = await sbSelect<{
        status: string;
        dl_name: string | null;
        dl_pan: string | null;
        dl_aadhaar_masked: string | null;
        name_match: boolean | null;
        verified_at: string | null;
      }>(
        cfg,
        `digilocker_sessions?select=status,dl_name,dl_pan,dl_aadhaar_masked,name_match,verified_at` +
          `&client_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc&limit=1`,
      );
      res.json(
        row
          ? {
              status: row.status,
              name: row.dl_name,
              pan: row.dl_pan,
              aadhaarMasked: row.dl_aadhaar_masked,
              nameMatch: row.name_match,
              verifiedAt: row.verified_at,
            }
          : { status: 'none' },
      );
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
    console.error('[cas/digilocker] unexpected', err);
    return res.status(500).json({ error: 'Something went wrong with identity verification.' });
  });

  return router;
}
