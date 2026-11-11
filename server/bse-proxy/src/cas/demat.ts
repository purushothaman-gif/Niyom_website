/**
 * DEMAT import — fetch a client's eCAS from CDSL by OTP, parse it, store it.
 *
 * Two authenticated steps the browser drives:
 *   POST /cas/demat/fetch   { clientId? }            → sends the OTP, returns a session id
 *   POST /cas/demat/verify  { clientId?, sessionId, otp } → parses + stores, returns a summary
 *   GET  /cas/demat/latest  { clientId? }            → the most recent import, for status
 *
 * Everything that talks to the vendor runs here on the droplet because this is
 * where the CASParser key lives. The PAN is used as the eCAS password and is
 * never stored or logged. Holdings land in the demat_* tables (never
 * nw_holdings); the portal overlays them onto the board at render time, exactly
 * as mutual funds are read from cas_*.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ProxyConfig } from '../config.js';
import { CasError, sbSelect } from './db.js';
import {
  cdslFetchStart,
  cdslFetchVerify,
  dematFetchEnabled,
  mapParseToDemat,
  smartParseUrl,
  storeDematParse,
} from './casparserCdsl.js';

/** New imports per client per rolling day — each verify spends vendor credits. */
const MAX_PER_DAY = 5;

/** The client this caller may act for. Never taken from the request body for a client. */
function callerClientId(req: Request, bodyClientId?: string): string {
  const caller = req.caller;
  if (!caller) throw new CasError('Caller not resolved.', 401);
  const id = caller.kind === 'staff' ? String(bodyClientId ?? '').trim() : (caller.clientId ?? '');
  if (!id) {
    throw new CasError(
      caller.kind === 'staff' ? 'A client is required.' : 'Your client record could not be found.',
      caller.kind === 'staff' ? 400 : 403,
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CasError('That is not a valid client id.', 400);
  return id;
}

interface ClientRow {
  id: string;
  pan: string | null;
  dob: string | null;
  demat_account: string | null;
  depository: string | null;
  full_name: string | null;
}

async function loadClient(cfg: ProxyConfig, clientId: string): Promise<ClientRow> {
  const [client] = await sbSelect<ClientRow>(
    cfg,
    `nw_clients?select=id,pan,dob,demat_account,depository,full_name&id=eq.${encodeURIComponent(clientId)}&limit=1`,
  );
  if (!client) throw new CasError('That client does not exist.', 404);
  return client;
}

/** The 16-digit CDSL BO id, or null when this client has no CDSL demat account. */
function cdslBoId(client: ClientRow): string | null {
  const acct = (client.demat_account ?? '').replace(/\s+/g, '');
  // CDSL BO ids are 16 numeric digits; NSDL ids begin "IN" and cannot OTP-fetch.
  return /^\d{16}$/.test(acct) ? acct : null;
}

export function dematRouter(cfg: ProxyConfig): Router {
  const router = Router();

  /** Whether demat import is available at all, so the portal can hide the entry. */
  router.get('/mode', (_req: Request, res: Response) => {
    res.json({ enabled: dematFetchEnabled(cfg) });
  });

  /** Step 1 — send the OTP to the client's depository-registered mobile. */
  router.post('/fetch', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!dematFetchEnabled(cfg)) throw new CasError('Demat import is not enabled yet.', 503);
      const clientId = callerClientId(req, (req.body as { clientId?: string })?.clientId);
      const client = await loadClient(cfg, clientId);

      const pan = (client.pan ?? '').trim().toUpperCase();
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
        throw new CasError('We need your PAN on file before importing demat holdings.', 400);
      }
      if (!client.dob) {
        throw new CasError('We need your date of birth on file before importing demat holdings.', 400);
      }
      const boId = cdslBoId(client);
      if (!boId) {
        // No CDSL account on file. A CDSL OTP fetch cannot reach an NSDL-first
        // investor (CASParser has no NSDL fetch endpoint, and NSDL issues that
        // client's consolidated statement). Rather than a dead end, tell the UI
        // to route them to email import, which handles their NSDL eCAS.
        return res.json({ needsEmail: true });
      }

      const { sessionId } = await cdslFetchStart(cfg, { pan, boId, dob: client.dob });
      // The session id is an opaque vendor token; the client carries it back to
      // /verify with the OTP. Nothing is stored until a statement is parsed.
      res.json({ sessionId, otpSentTo: 'your depository-registered mobile' });
    } catch (err) {
      next(err);
    }
  });

  /** Step 2 — verify the OTP, parse the eCAS, store the holdings. */
  router.post('/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!dematFetchEnabled(cfg)) throw new CasError('Demat import is not enabled yet.', 503);
      const body = req.body as { clientId?: string; sessionId?: string; otp?: string };
      const clientId = callerClientId(req, body.clientId);
      const sessionId = String(body.sessionId ?? '').trim();
      const otp = String(body.otp ?? '').trim();
      if (!sessionId) throw new CasError('Your session has expired. Please start again.', 400);
      if (!/^\d{4,8}$/.test(otp)) throw new CasError('Enter the OTP from your phone.', 400);

      const client = await loadClient(cfg, clientId);
      const pan = (client.pan ?? '').trim().toUpperCase();

      // Guard the paid steps: a handful of imports a day is plenty.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recent = await sbSelect<{ id: string }>(
        cfg,
        `demat_imports?select=id&client_id=eq.${encodeURIComponent(clientId)}` +
          `&created_at=gte.${encodeURIComponent(since)}&limit=${MAX_PER_DAY}`,
      );
      if (recent.length >= MAX_PER_DAY) {
        throw new CasError('You have imported several times today. Please try again tomorrow.', 429);
      }

      const files = await cdslFetchVerify(cfg, sessionId, otp, 1);
      const parsed = await smartParseUrl(cfg, files[0].url, pan);
      const mapped = mapParseToDemat(parsed);

      const stored = await storeDematParse(cfg, {
        clientId,
        pan,
        mapped,
        source: 'cdsl_otp',
        createdBy: req.caller?.kind === 'staff' ? (req.caller.employeeId ?? null) : null,
      });
      if (stored.duplicate) {
        return res.json({ importId: stored.importId, duplicate: true, totalValue: stored.totalValue });
      }
      res.json({
        importId: stored.importId,
        status: 'parsed',
        statementDate: stored.statementDate,
        totalValue: stored.totalValue,
        accounts: mapped.accounts.length,
        holdings: stored.holdings,
        byClass: stored.byClass,
      });
    } catch (err) {
      next(err);
    }
  });

  /** The most recent import, for a status line in the UI. */
  router.get('/latest', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = callerClientId(req, String(req.query.clientId ?? ''));
      const [row] = await sbSelect<{
        id: string;
        status: string;
        cas_type: string | null;
        statement_date: string | null;
        total_value: number | null;
        holding_count: number | null;
        created_at: string;
      }>(
        cfg,
        `demat_imports?select=id,status,cas_type,statement_date,total_value,holding_count,created_at` +
          `&client_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc&limit=1`,
      );
      res.json(row ?? null);
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
    console.error('[cas/demat] unexpected', err);
    return res.status(500).json({ error: 'Something went wrong with the demat import.' });
  });

  return router;
}
