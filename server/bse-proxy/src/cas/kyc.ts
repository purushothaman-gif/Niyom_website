/**
 * KYC + ARN checks — the onboarding side of CASParser.
 *
 *   POST /cas/kyc/pan-status  { clientId? }  → KRA KYC status, cached on nw_clients
 *   POST /cas/kyc/arn-verify  { arn }        → AMFI ARN check (stateless)
 *   GET  /cas/kyc/mode                       → whether these are enabled
 *
 * Staff-authenticated: an RM runs these while onboarding. A client may check
 * their own KYC, but never verify an ARN. Writes go through the service role,
 * so a browser cannot forge a KYC verdict onto a record.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ProxyConfig } from '../config.js';
import { CasError, sbPatch, sbSelect } from './db.js';
import { kycEnabled, panKycStatus, verifyArn } from './casparserKyc.js';

function staffOrOwnClientId(req: Request, bodyClientId?: string): string {
  const caller = req.caller;
  if (!caller) throw new CasError('Caller not resolved.', 401);
  const id = caller.kind === 'staff' ? String(bodyClientId ?? '').trim() : (caller.clientId ?? '');
  if (!id) throw new CasError(caller.kind === 'staff' ? 'A client is required.' : 'Your record was not found.', 400);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CasError('That is not a valid client id.', 400);
  return id;
}

/* ------------------------------------------------- public (website signup) */

// In-memory per-IP throttle for the anonymous PAN-status check — it costs a
// paid CASParser call and reveals a yes/no KYC flag, so it must not be spammable.
const publicHits = new Map<string, number[]>();
const PUBLIC_MAX = 10;
const PUBLIC_WINDOW_MS = 60 * 60 * 1000;
function publicThrottled(ip: string): boolean {
  const now = Date.now();
  const hits = (publicHits.get(ip) ?? []).filter((t) => now - t < PUBLIC_WINDOW_MS);
  hits.push(now);
  publicHits.set(ip, hits);
  return hits.length > PUBLIC_MAX;
}
function reqIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string) ?? '';
  return fwd.split(',')[0].trim() || req.ip || 'unknown';
}

/**
 * PUBLIC (no session) KYC status for the website self-signup. The visitor has
 * no account yet and enters their own PAN; we return only a compliant flag +
 * status (never the per-KRA identity detail the authed route caches). Throttled
 * per IP. Mounted before the auth gate; other /cas/kyc/* paths fall through to
 * the authed router below.
 */
export function kycPublicRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.get('/public-mode', (_req: Request, res: Response) => {
    res.json({ enabled: kycEnabled(cfg) });
  });

  router.post('/public-pan-status', async (req: Request, res: Response) => {
    try {
      if (!kycEnabled(cfg)) return res.json({ enabled: false });
      if (publicThrottled(reqIp(req))) {
        return res.status(429).json({ error: 'Too many checks just now. Please try again in a little while.' });
      }
      const pan = String((req.body as { pan?: string })?.pan ?? '').trim().toUpperCase();
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return res.status(400).json({ error: 'Enter a valid PAN.' });
      const kyc = await panKycStatus(cfg, pan);
      return res.json({ enabled: true, compliant: kyc.compliant, status: kyc.status, activeKra: kyc.activeKra });
    } catch (err) {
      console.error('[cas/kyc] public-pan-status', err instanceof Error ? err.message.slice(0, 120) : 'error');
      return res.status(502).json({ error: 'We could not check your KYC right now.' });
    }
  });

  return router;
}

export function kycRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.get('/mode', (_req: Request, res: Response) => {
    res.json({ enabled: kycEnabled(cfg) });
  });

  /** Check a client's KYC across the KRAs and cache it on their record. */
  router.post('/pan-status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!kycEnabled(cfg)) throw new CasError('KYC check is not enabled yet.', 503);
      const clientId = staffOrOwnClientId(req, (req.body as { clientId?: string })?.clientId);

      const [client] = await sbSelect<{ id: string; pan: string | null }>(
        cfg,
        `nw_clients?select=id,pan&id=eq.${encodeURIComponent(clientId)}&limit=1`,
      );
      if (!client) throw new CasError('That client does not exist.', 404);
      const pan = (client.pan ?? '').trim().toUpperCase();
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new CasError('A valid PAN is needed to check KYC.', 400);

      const kyc = await panKycStatus(cfg, pan);
      await sbPatch(cfg, `nw_clients?id=eq.${encodeURIComponent(clientId)}`, {
        kra_status: kyc.status,
        kra_compliant: kyc.compliant,
        kra_active: kyc.activeKra,
        kra_checked_at: new Date().toISOString(),
        kra_detail: kyc.kras,
      }).catch(() => undefined);

      res.json(kyc);
    } catch (err) {
      next(err);
    }
  });

  /** Verify an AMFI ARN before onboarding a partner. Staff only; stateless. */
  router.post('/arn-verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!kycEnabled(cfg)) throw new CasError('ARN verification is not enabled yet.', 503);
      if (req.caller?.kind !== 'staff') throw new CasError('Only staff may verify an ARN.', 403);
      const raw = String((req.body as { arn?: string })?.arn ?? '').trim().toUpperCase();
      if (!/^(ARN-)?[0-9]+$/.test(raw)) throw new CasError('Enter a valid ARN (digits, optionally ARN-prefixed).', 400);

      const result = await verifyArn(cfg, raw.replace(/^ARN-/, ''));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
    console.error('[cas/kyc] unexpected', err);
    return res.status(500).json({ error: 'Something went wrong with the check.' });
  });

  return router;
}
