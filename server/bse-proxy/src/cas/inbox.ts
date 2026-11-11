/**
 * Email inbox import — connect a mailbox once, pull CAS statements from it.
 *
 * The OAuth callback is PUBLIC (a browser redirect from the provider carries no
 * session), so it is a separate router mounted before the JWT gate; it is tied
 * back to the right client only by the `state` it round-trips. Everything else
 * is client-authenticated:
 *
 *   POST /cas/inbox/connect     { provider? } → the provider's consent URL
 *   GET  /cas/inbox/callback    (public)      → stores the token, shows a page
 *   GET  /cas/inbox/status                    → is a mailbox connected?
 *   POST /cas/inbox/sync                       → pull + import new statements
 *   POST /cas/inbox/disconnect                 → revoke
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ProxyConfig } from '../config.js';
import { CasError, sbInsert, sbPatch, sbSelect } from './db.js';
import { mapParseToDemat, smartParseUrl, storeDematParse } from './casparserCdsl.js';
import { inboxConnect, inboxDisconnect, inboxEnabled, inboxListCas } from './casparserInbox.js';

const PROVIDERS = ['gmail', 'outlook', 'zoho'];
const DEMAT_TYPES = new Set(['cdsl', 'nsdl']);

function ownClientId(req: Request, bodyClientId?: string): string {
  const caller = req.caller;
  if (!caller) throw new CasError('Caller not resolved.', 401);
  const id = caller.kind === 'staff' ? String(bodyClientId ?? '').trim() : (caller.clientId ?? '');
  if (!id) throw new CasError('Your record was not found.', 403);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CasError('That is not a valid client id.', 400);
  return id;
}

/** Where the client lands after the provider redirect — the portal, not here. */
function portalOrigin(cfg: ProxyConfig): string {
  return cfg.allowedOrigins.find((o) => o.includes('niyomwealth.com')) ?? cfg.allowedOrigins[0] ?? 'https://www.niyomwealth.com';
}

function resultPage(title: string, body: string, href: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0b1220;color:#e8edf5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:360px;text-align:center;padding:32px}h1{font-size:18px;margin:0 0 8px}p{color:#9fb0c7;font-size:14px;line-height:1.5}
a{display:inline-block;margin-top:20px;background:#c6a35a;color:#0b1220;text-decoration:none;font-weight:700;padding:10px 20px;border-radius:10px;font-size:14px}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p><a href="${href}">Return to Niyom</a></div></body></html>`;
}

/** PUBLIC — the OAuth provider redirects the browser here. Mounted before the gate. */
export function inboxCallbackRouter(cfg: ProxyConfig): Router {
  const router = Router();
  router.get('/callback', async (req: Request, res: Response) => {
    const back = `${portalOrigin(cfg)}/client-login?view=portfolio`;
    try {
      const state = String(req.query.state ?? '');
      const token = String(req.query.inbox_token ?? '');
      const email = String(req.query.email ?? '');
      const error = String(req.query.error ?? '');
      if (!state) return res.status(400).send(resultPage('Something went wrong', 'That link was invalid. Please try connecting again.', back));

      const [row] = await sbSelect<{ id: string }>(
        cfg,
        `inbox_connections?select=id&state=eq.${encodeURIComponent(state)}&limit=1`,
      );
      if (!row) return res.status(404).send(resultPage('Link expired', 'This connection link has expired. Please try again.', back));

      if (error || !token) {
        await sbPatch(cfg, `inbox_connections?id=eq.${row.id}`, {
          status: 'error',
          last_error: error || 'no_token',
          state: null,
        }).catch(() => undefined);
        return res.send(resultPage('Not connected', 'You did not finish connecting your email. You can try again anytime.', back));
      }

      await sbPatch(cfg, `inbox_connections?id=eq.${row.id}`, {
        status: 'active',
        inbox_token: token,
        email: email || null,
        connected_at: new Date().toISOString(),
        last_error: null,
        state: null,
      });
      res.send(resultPage('Email connected', 'We can now bring in your statements automatically. You can close this tab.', back));
    } catch {
      res.status(500).send(resultPage('Something went wrong', 'Please try connecting again in a moment.', back));
    }
  });
  return router;
}

/** Client-authenticated inbox actions. Mounted after the gate. */
export function inboxRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.get('/mode', (_req: Request, res: Response) => res.json({ enabled: inboxEnabled(cfg) }));

  /** Start OAuth — returns the provider consent URL for the browser to open. */
  router.post('/connect', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!inboxEnabled(cfg)) throw new CasError('Email import is not enabled yet.', 503);
      const body = req.body as { clientId?: string; provider?: string };
      const clientId = ownClientId(req, body.clientId);
      const provider = PROVIDERS.includes(String(body.provider)) ? String(body.provider) : 'gmail';
      const state = randomUUID();

      // One pending/active row per client: clear any stale one first.
      await sbPatch(cfg, `inbox_connections?client_id=eq.${encodeURIComponent(clientId)}&status=eq.pending`, {
        status: 'disconnected',
        state: null,
      }).catch(() => undefined);
      await sbInsert(cfg, 'inbox_connections', [
        {
          id: randomUUID(),
          client_id: clientId,
          provider,
          status: 'pending',
          state,
          created_by: req.caller?.kind === 'staff' ? (req.caller.employeeId ?? null) : null,
        },
      ]);

      const { oauthUrl } = await inboxConnect(cfg, {
        redirectUri: `${cfg.publicBaseUrl ?? 'https://api.niyomwealth.com'}/cas/inbox/callback`,
        state,
        provider,
      });
      res.json({ oauthUrl });
    } catch (err) {
      next(err);
    }
  });

  /** Is a mailbox connected? Never returns the token. */
  router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = ownClientId(req, String(req.query.clientId ?? ''));
      const [row] = await sbSelect<{ status: string; provider: string; email: string | null; last_synced_at: string | null }>(
        cfg,
        `inbox_connections?select=status,provider,email,last_synced_at&client_id=eq.${encodeURIComponent(clientId)}` +
          `&order=created_at.desc&limit=1`,
      );
      res.json(
        row && row.status === 'active'
          ? { connected: true, provider: row.provider, email: row.email, lastSyncedAt: row.last_synced_at }
          : { connected: false },
      );
    } catch (err) {
      next(err);
    }
  });

  /** Pull CAS files from the mailbox and import the demat ones. */
  router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!inboxEnabled(cfg)) throw new CasError('Email import is not enabled yet.', 503);
      const clientId = ownClientId(req, (req.body as { clientId?: string })?.clientId);

      const [conn] = await sbSelect<{ id: string; inbox_token: string | null }>(
        cfg,
        `inbox_connections?select=id,inbox_token&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&limit=1`,
      );
      if (!conn?.inbox_token) throw new CasError('No email is connected. Connect one first.', 400);

      const [client] = await sbSelect<{ pan: string | null }>(
        cfg,
        `nw_clients?select=pan&id=eq.${encodeURIComponent(clientId)}&limit=1`,
      );
      const pan = (client?.pan ?? '').trim().toUpperCase();

      const { files, requiresReconnect } = await inboxListCas(cfg, conn.inbox_token);
      if (requiresReconnect) {
        await sbPatch(cfg, `inbox_connections?id=eq.${conn.id}`, { status: 'error', last_error: 'requires_reconnect' }).catch(() => undefined);
        return res.json({ reconnectNeeded: true });
      }

      let imported = 0;
      let holdings = 0;
      let duplicates = 0;
      let mfFound = 0;
      for (const f of files) {
        if (!DEMAT_TYPES.has(f.casType)) {
          // CAMS/KFintech MF statements go through our own reconciling parser —
          // wired in a later step. Count them so the client knows they exist.
          if (f.casType === 'cams' || f.casType === 'kfintech') mfFound += 1;
          continue;
        }
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) || !f.url) continue;
        try {
          const parsed = await smartParseUrl(cfg, f.url, pan);
          const r = await storeDematParse(cfg, {
            clientId,
            pan,
            mapped: mapParseToDemat(parsed),
            source: 'inbox',
          });
          if (r.duplicate) duplicates += 1;
          else {
            imported += 1;
            holdings += r.holdings;
          }
        } catch {
          // One unreadable statement must not fail the whole sweep.
        }
      }

      await sbPatch(cfg, `inbox_connections?id=eq.${conn.id}`, { last_synced_at: new Date().toISOString() }).catch(() => undefined);
      res.json({ imported, holdings, duplicates, mfFound, filesSeen: files.length });
    } catch (err) {
      next(err);
    }
  });

  /** Revoke the connection, both at the vendor and here. */
  router.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = ownClientId(req, (req.body as { clientId?: string })?.clientId);
      const [conn] = await sbSelect<{ id: string; inbox_token: string | null }>(
        cfg,
        `inbox_connections?select=id,inbox_token&client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&limit=1`,
      );
      if (conn?.inbox_token) await inboxDisconnect(cfg, conn.inbox_token);
      if (conn) await sbPatch(cfg, `inbox_connections?id=eq.${conn.id}`, { status: 'disconnected', inbox_token: null }).catch(() => undefined);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
    console.error('[cas/inbox] unexpected', err);
    return res.status(500).json({ error: 'Something went wrong with email import.' });
  });

  return router;
}
