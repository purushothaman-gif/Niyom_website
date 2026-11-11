/**
 * Inbound-email import — a client forwards their CAS to a dedicated address.
 *
 *   POST /cas/inbound/ensure    → create (or return) the forward-to address
 *   GET  /cas/inbound/status    → the address + when a statement last arrived
 *   POST /cas/inbound/check     → pull now (same work the webhook does)
 *   POST /cas/inbound/disable   → remove the address
 *   POST /cas/inbound/webhook   (PUBLIC) → CASParser's trigger when mail arrives
 *
 * The webhook is unsigned, so it is a trigger only: it names an inbound_email_id,
 * we look that row up and re-fetch the authoritative file list with our key.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ProxyConfig } from '../config.js';
import { CasError, sbInsert, sbPatch, sbSelect } from './db.js';
import { mapParseToDemat, smartParseUrl, storeDematParse } from './casparserCdsl.js';
import { createInboundEmail, deleteInboundEmail, inboundEnabled, listInboundFiles } from './casparserInbound.js';
import { importMfFromUrl } from './mfImport.js';

const DEMAT_TYPES = new Set(['cdsl', 'nsdl']);
const SOURCES = ['cdsl', 'nsdl', 'cams', 'kfintech'];

interface Row {
  id: string;
  client_id: string;
  inbound_email_id: string | null;
  address: string | null;
  last_cursor: string | null;
}

function ownClientId(req: Request, bodyClientId?: string): string {
  const caller = req.caller;
  if (!caller) throw new CasError('Caller not resolved.', 401);
  const id = caller.kind === 'staff' ? String(bodyClientId ?? '').trim() : (caller.clientId ?? '');
  if (!id) throw new CasError('Your record was not found.', 403);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CasError('That is not a valid client id.', 400);
  return id;
}

/** Pull new files for one address and import the demat ones. Idempotent via the cursor. */
async function importNew(cfg: ProxyConfig, row: Row): Promise<{ imported: number; holdings: number; mfImported: number; mfManual: number; filesSeen: number }> {
  if (!row.inbound_email_id) return { imported: 0, holdings: 0, mfImported: 0, mfManual: 0, filesSeen: 0 };
  const [client] = await sbSelect<{ pan: string | null }>(
    cfg,
    `nw_clients?select=pan&id=eq.${encodeURIComponent(row.client_id)}&limit=1`,
  );
  const pan = (client?.pan ?? '').trim().toUpperCase();

  const { files, cursor } = await listInboundFiles(cfg, row.inbound_email_id, row.last_cursor);
  let imported = 0;
  let holdings = 0;
  let mfImported = 0;
  let mfManual = 0;
  const panOk = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  for (const f of files) {
    if (!f.url) continue;
    // Mutual funds import through our own reconciling parser; demat through the
    // CASParser path. See mfImport.ts for the PAN-password caveat.
    if (f.casType === 'cams' || f.casType === 'kfintech') {
      if (!panOk) {
        mfManual += 1;
        continue;
      }
      const mf = await importMfFromUrl(cfg, row.client_id, f.url, pan);
      if (mf.duplicate) {
        // already imported
      } else if (mf.ok) {
        mfImported += 1;
      } else {
        mfManual += 1;
      }
      continue;
    }
    if (!DEMAT_TYPES.has(f.casType) || !panOk) continue;
    try {
      const r = await storeDematParse(cfg, {
        clientId: row.client_id,
        pan,
        mapped: mapParseToDemat(await smartParseUrl(cfg, f.url, pan)),
        source: 'inbound_email',
      });
      if (!r.duplicate) {
        imported += 1;
        holdings += r.holdings;
      }
    } catch {
      // One bad file must not abort the batch.
    }
  }

  await sbPatch(cfg, `cas_inbound_email?id=eq.${row.id}`, {
    last_received_at: files.length ? new Date().toISOString() : undefined,
    last_cursor: cursor ?? row.last_cursor,
  }).catch(() => undefined);

  return { imported, holdings, mfImported, mfManual, filesSeen: files.length };
}

/** PUBLIC — CASParser POSTs here when a forwarded statement is processed. */
export function inboundWebhookRouter(cfg: ProxyConfig): Router {
  const router = Router();
  router.post('/webhook', async (req: Request, res: Response) => {
    try {
      const id = String((req.body as { inbound_email_id?: string })?.inbound_email_id ?? '');
      if (!id) return res.status(400).json({ error: 'missing id' });
      const [row] = await sbSelect<Row>(
        cfg,
        `cas_inbound_email?select=id,client_id,inbound_email_id,address,last_cursor&inbound_email_id=eq.${encodeURIComponent(id)}&status=eq.active&limit=1`,
      );
      // Unknown or disabled: acknowledge so the vendor stops retrying.
      if (!row) return res.json({ ok: true, ignored: true });
      // Body URLs are never trusted; importNew re-fetches with our key.
      await importNew(cfg, row).catch(() => undefined);
      res.json({ ok: true });
    } catch {
      // Still 200: a 5xx makes CASParser retry a transient failure forever.
      res.json({ ok: true });
    }
  });
  return router;
}

/** Client-authenticated inbound actions. */
export function inboundRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.get('/mode', (_req: Request, res: Response) => res.json({ enabled: inboundEnabled(cfg) }));

  /** Get-or-create the client's forward-to address. */
  router.post('/ensure', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!inboundEnabled(cfg)) throw new CasError('Email import is not enabled yet.', 503);
      const clientId = ownClientId(req, (req.body as { clientId?: string })?.clientId);

      const [existing] = await sbSelect<Row & { address: string | null }>(
        cfg,
        `cas_inbound_email?select=id,client_id,inbound_email_id,address,last_cursor&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&limit=1`,
      );
      if (existing?.address) return res.json({ address: existing.address });

      const { inboundEmailId, address } = await createInboundEmail(cfg, {
        reference: clientId,
        callbackUrl: `${cfg.publicBaseUrl ?? 'https://api.niyomwealth.com'}/cas/inbound/webhook`,
        allowedSources: SOURCES,
      });
      await sbInsert(cfg, 'cas_inbound_email', [
        {
          id: randomUUID(),
          client_id: clientId,
          inbound_email_id: inboundEmailId,
          address,
          reference: clientId,
          status: 'active',
          created_by: req.caller?.kind === 'staff' ? (req.caller.employeeId ?? null) : null,
        },
      ]);
      res.json({ address });
    } catch (err) {
      next(err);
    }
  });

  router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = ownClientId(req, String(req.query.clientId ?? ''));
      const [row] = await sbSelect<{ address: string | null; last_received_at: string | null }>(
        cfg,
        `cas_inbound_email?select=address,last_received_at&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&limit=1`,
      );
      res.json(row?.address ? { address: row.address, lastReceivedAt: row.last_received_at } : { address: null });
    } catch (err) {
      next(err);
    }
  });

  /** Pull now, for a client who just forwarded and does not want to wait. */
  router.post('/check', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!inboundEnabled(cfg)) throw new CasError('Email import is not enabled yet.', 503);
      const clientId = ownClientId(req, (req.body as { clientId?: string })?.clientId);
      const [row] = await sbSelect<Row>(
        cfg,
        `cas_inbound_email?select=id,client_id,inbound_email_id,address,last_cursor&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&limit=1`,
      );
      if (!row?.inbound_email_id) throw new CasError('No forwarding address is set up yet.', 400);
      res.json(await importNew(cfg, row));
    } catch (err) {
      next(err);
    }
  });

  router.post('/disable', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = ownClientId(req, (req.body as { clientId?: string })?.clientId);
      const [row] = await sbSelect<Row>(
        cfg,
        `cas_inbound_email?select=id,client_id,inbound_email_id,address,last_cursor&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&limit=1`,
      );
      if (row?.inbound_email_id) await deleteInboundEmail(cfg, row.inbound_email_id);
      if (row) await sbPatch(cfg, `cas_inbound_email?id=eq.${row.id}`, { status: 'disabled' }).catch(() => undefined);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
    console.error('[cas/inbound] unexpected', err);
    return res.status(500).json({ error: 'Something went wrong with email forwarding.' });
  });

  return router;
}
