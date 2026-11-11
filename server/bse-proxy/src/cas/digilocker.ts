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
import { randomUUID } from 'node:crypto';
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

/** PUBLIC — DigiLocker redirects the browser here after consent. */
export function digilockerCallbackRouter(cfg: ProxyConfig): Router {
  const router = Router();
  router.get('/callback', async (req: Request, res: Response) => {
    const back = portalOrigin(cfg);
    try {
      const sessionId = String(req.query.id ?? '');
      const state = String(req.query.state ?? '');
      const success = String(req.query.success ?? '') === 'true';
      if (!sessionId && !state) return res.status(400).send(page('Something went wrong', 'That link was invalid.', back));

      const [row] = await sbSelect<{ id: string; client_id: string }>(
        cfg,
        `digilocker_sessions?select=id,client_id&` +
          (sessionId ? `session_id=eq.${encodeURIComponent(sessionId)}` : `state=eq.${encodeURIComponent(state)}`) +
          `&limit=1`,
      );
      if (!row) return res.status(404).send(page('Link expired', 'This verification link has expired.', back));

      if (!success) {
        await sbPatch(cfg, `digilocker_sessions?id=eq.${row.id}`, {
          status: 'failed',
          error: String(req.query.error ?? 'consent_declined'),
          state: null,
        }).catch(() => undefined);
        return res.send(page('Not verified', 'The verification was not completed. You can try again anytime.', back));
      }

      const result = await readDigilockerResult(cfg, sessionId);
      const [client] = await sbSelect<{ full_name: string | null }>(
        cfg,
        `nw_clients?select=full_name&id=eq.${encodeURIComponent(row.client_id)}&limit=1`,
      );
      await sbPatch(cfg, `digilocker_sessions?id=eq.${row.id}`, {
        status: result.verified ? 'verified' : 'failed',
        dl_name: result.name,
        dl_dob: result.dob,
        dl_pan: result.pan,
        dl_aadhaar_masked: result.aadhaarMasked,
        name_match: namesMatch(result.name, client?.full_name ?? null),
        result: result.raw,
        verified_at: result.verified ? new Date().toISOString() : null,
        state: null,
      });
      res.send(page('Identity verified', 'Thank you — your documents were shared successfully. You can close this tab.', back));
    } catch {
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
