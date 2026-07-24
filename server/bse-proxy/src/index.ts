/**
 * NIYOM BSE Proxy — entry point.
 * -----------------------------------------------------------------------------
 * Runs on the DigitalOcean droplet (static IP whitelisted with BSE). Exposes
 * the routes the app's liveGateway calls (BSE_PROXY_ROUTES in the web repo) and
 * translates them onto the BSE StAR MF 2.0 REST API.
 *
 * Security model:
 *   - BSE credentials live only here (env), never in the browser.
 *   - Callers must present a valid Supabase JWT (the portal user's session);
 *     verified against ${SUPABASE_URL}/auth/v1/user on every request.
 *   - CORS restricted to the NIYOM app origins.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import { BseClient, BseError } from './bseClient.js';
import { webhookRouter } from './webhooks.js';
import {
  toAppOrderResult,
  toAppScheme,
  toAppTxnResult,
  toOrderNew,
  toRedemption,
  toSwitch,
  toSxpRegister,
  type AppOrderRequest,
  type AppRedemptionRequest,
  type AppSwitchRequest,
} from './mappers.js';

const cfg = loadConfig();
const bse = new BseClient(cfg);
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin: cfg.allowedOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

/* ------------------------- caller authentication -------------------------- */

async function requireSupabaseUser(req: Request, res: Response, next: NextFunction) {
  if (!cfg.requireAuth) return next();
  const auth = req.header('authorization');
  const jwt = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: cfg.supabaseAnonKey },
    });
    if (!r.ok) return res.status(401).json({ error: 'Invalid session' });
    next();
  } catch {
    res.status(502).json({ error: 'Auth verification unavailable' });
  }
}

/* --------------------------------- routes --------------------------------- */

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: cfg.bseEnv, ts: new Date().toISOString() });
});

// Public — BSE calls this, so it must sit BEFORE the Supabase-JWT gate.
app.use('/webhooks', webhookRouter(cfg));

app.use(requireSupabaseUser);

/** Scheme master → app FundScheme[]. */
app.get('/schemes', async (_req, res, next) => {
  try {
    // UAT-VERIFY: list envelope params accepted by master_scheme_list.
    const data = await bse.post<Record<string, unknown>>('/v2/master_scheme_list', {
      start: 0,
      length: 5000,
      fields: ['ALL'],
      format: 'json',
    });
    const rows = (data.lists ?? data.list ?? data) as Record<string, unknown>[];
    res.json(Array.isArray(rows) ? rows.map(toAppScheme) : []);
  } catch (err) {
    next(err);
  }
});

app.get('/schemes/:code', async (req, res, next) => {
  try {
    const data = await bse.post<Record<string, unknown>>('/v2/master_scheme_list', {
      start: 0,
      length: 1,
      fields: ['ALL'],
      format: 'json',
      search: { value: req.params.code },
    });
    const rows = (data.lists ?? data.list ?? []) as Record<string, unknown>[];
    res.json(rows.length ? toAppScheme(rows[0]) : null);
  } catch (err) {
    next(err);
  }
});

/** Lumpsum or SIP placement. */
app.post('/order', async (req, res, next) => {
  try {
    const body = req.body as AppOrderRequest & { schemeName?: string };
    const result =
      body.type === 'sip'
        ? await bse.post<Record<string, unknown>>('/v2/sxp_register', toSxpRegister(body, cfg.bseMemberCode))
        : await bse.post<Record<string, unknown>>('/v2/order_new', toOrderNew(body, cfg.bseMemberCode));
    res.json(toAppOrderResult(result, body, body.schemeName ?? body.schemeCode));
  } catch (err) {
    next(err);
  }
});

app.post('/redemption', async (req, res, next) => {
  try {
    const body = req.body as AppRedemptionRequest;
    const result = await bse.post<Record<string, unknown>>('/v2/order_new', toRedemption(body, cfg.bseMemberCode));
    const detail =
      body.mode === 'all' ? `Full redemption · ${body.units.toFixed(3)} units` : `₹${body.amount} redeemed`;
    res.json(toAppTxnResult(result, 'redeem', body.schemeName, detail, body.amount));
  } catch (err) {
    next(err);
  }
});

app.post('/switch', async (req, res, next) => {
  try {
    const body = req.body as AppSwitchRequest;
    const result = await bse.post<Record<string, unknown>>('/v2/order_new', toSwitch(body, cfg.bseMemberCode));
    res.json(
      toAppTxnResult(result, 'switch', body.fromSchemeName, `Switched ₹${body.amount} to ${body.toSchemeName}`, body.amount),
    );
  } catch (err) {
    next(err);
  }
});

app.post('/cancel', async (req, res, next) => {
  try {
    const { orderId } = req.body as { orderId: string };
    const result = await bse.post<Record<string, unknown>>('/v2/order_cancel', { id: Number(orderId) || orderId });
    res.json(toAppTxnResult(result, 'redeem', '—', `Order ${orderId} cancelled`, 0));
  } catch (err) {
    next(err);
  }
});

/** UCC registration — payload passthrough of the app's UccRegistrationRequest. */
app.post('/ucc', async (req, res, next) => {
  try {
    // UAT-VERIFY: field-by-field mapping of add_ucc (holder/bank/address/FATCA
    // objects) once the sandbox is available; passthrough gets the errors back
    // verbatim for mapping work.
    const result = await bse.post<Record<string, unknown>>('/v2/add_ucc', req.body);
    res.json({
      clientCode: String(result.ucc ?? result.client_code ?? ''),
      status: String(result.status ?? 'PENDING_APPROVAL'),
      isMock: false,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/mandate', async (req, res, next) => {
  try {
    const result = await bse.post<Record<string, unknown>>('/mandate_register', req.body);
    res.json({
      mandateId: String(result.exch_mandate_id ?? result.id ?? ''),
      status: String(result.status ?? 'PENDING'),
      authUrl: (result.enach_url as string) ?? undefined, // UAT-VERIFY key
      isMock: false,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/payment/link', async (req, res, next) => {
  try {
    const result = await bse.post<Record<string, unknown>>('/v2/get_payment_detail', req.body);
    res.json({ paymentUrl: String(result.payment_url ?? result.url ?? ''), isMock: false });
  } catch (err) {
    next(err);
  }
});

app.post('/payment/status', async (req, res, next) => {
  try {
    const { orderId } = req.body as { orderId: string };
    const result = await bse.post<Record<string, unknown>>('/get_bse_pg_payment_status', { order_id: orderId });
    res.json({
      orderId,
      status: String(result.status ?? 'PENDING').toUpperCase(),
      isMock: false,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ error handler ----------------------------- */

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof BseError) {
    console.error(`[bse] ${err.message}`, err.bseMessages ?? '');
    return res.status(err.httpStatus >= 500 ? 502 : err.httpStatus).json({
      error: err.message,
      details: err.bseMessages ?? null,
    });
  }
  console.error('[proxy] unexpected', err);
  res.status(500).json({ error: 'Internal proxy error' });
});

app.listen(cfg.port, () => {
  console.log(`NIYOM BSE proxy listening on :${cfg.port} → ${cfg.bseBaseUrl} (${cfg.bseEnv})`);
});
