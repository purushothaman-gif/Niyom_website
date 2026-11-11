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
