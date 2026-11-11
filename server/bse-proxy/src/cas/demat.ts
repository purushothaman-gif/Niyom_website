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
import { randomUUID } from 'node:crypto';
import type { ProxyConfig } from '../config.js';
import { CasError, sbInsert, sbSelect } from './db.js';
import {
  cdslFetchStart,
  cdslFetchVerify,
  dematFetchEnabled,
  mapParseToDemat,
  smartParseUrl,
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
        throw new CasError(
          'This only works with a CDSL demat account on file. Your relationship manager can help import an NSDL statement.',
          400,
        );
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

      // Re-importing the same snapshot is a no-op, not a duplicate.
      if (mapped.statementDate && mapped.casType) {
        const [dupe] = await sbSelect<{ id: string }>(
          cfg,
          `demat_imports?select=id&client_id=eq.${encodeURIComponent(clientId)}` +
            `&cas_type=eq.${encodeURIComponent(mapped.casType)}` +
            `&statement_date=eq.${encodeURIComponent(mapped.statementDate)}` +
            `&status=eq.parsed&limit=1`,
        );
        if (dupe) {
          return res.json({ importId: dupe.id, duplicate: true, totalValue: mapped.totalValue });
        }
      }

      const importId = randomUUID();
      const holdingCount = mapped.accounts.reduce((n, a) => n + a.holdings.length, 0);

      await sbInsert(cfg, 'demat_imports', [
        {
          id: importId,
          client_id: clientId,
          investor_pan: mapped.investorPan ?? pan,
          investor_name: mapped.investorName ?? client.full_name,
          source: 'cdsl_otp',
          cas_type: mapped.casType,
          statement_date: mapped.statementDate,
          status: 'parsed',
          total_value: mapped.totalValue,
          account_count: mapped.accounts.length,
          holding_count: holdingCount,
          created_by: req.caller?.kind === 'staff' ? (req.caller.employeeId ?? null) : null,
        },
      ]);

      // Build children with client-generated ids, so each table inserts once.
      const accountRows: Record<string, unknown>[] = [];
      const holdingRows: Record<string, unknown>[] = [];
      for (const acc of mapped.accounts) {
        const accountId = randomUUID();
        accountRows.push({
          id: accountId,
          import_id: importId,
          client_id: clientId,
          depository: acc.depository,
          dp_id: acc.dpId,
          dp_name: acc.dpName,
          bo_id: acc.boId,
          value: acc.value,
        });
        for (const h of acc.holdings) {
          holdingRows.push({
            id: randomUUID(),
            import_id: importId,
            account_id: accountId,
            client_id: clientId,
            asset_class: h.assetClass,
            isin: h.isin,
            name: h.name,
            units: h.units,
            value: h.value,
            extra: h.extra,
          });
        }
      }
      await sbInsert(cfg, 'demat_accounts', accountRows);
      await sbInsert(cfg, 'demat_holdings', holdingRows);

      const byClass: Record<string, number> = {};
      for (const a of mapped.accounts) for (const h of a.holdings) byClass[h.assetClass] = (byClass[h.assetClass] ?? 0) + 1;

      res.json({
        importId,
        status: 'parsed',
        statementDate: mapped.statementDate,
        totalValue: mapped.totalValue,
        accounts: mapped.accounts.length,
        holdings: holdingCount,
        byClass,
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
