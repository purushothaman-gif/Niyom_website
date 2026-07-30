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
  toAddUcc,
  toAppUccResult,
  type AppUccRequest,
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

/**
 * Cashfree PAN verification relay. Called server-to-server by the Supabase edge
 * function (public-pan-verify) with a shared secret — NOT a Supabase JWT — so it
 * sits before the JWT gate. The whole point of routing through this droplet is
 * that Cashfree only accepts calls from this box's whitelisted static IP.
 * The edge function keeps all app logic (ownership, dedup, DB write); this route
 * is a thin pass-through that adds the static IP + holds the Cashfree keys.
 */
app.post('/verify/pan', async (req: Request, res: Response) => {
  if (!cfg.panRelaySecret || req.header('x-relay-secret') !== cfg.panRelaySecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!cfg.cashfreeVerifyClientId || !cfg.cashfreeVerifySecret) {
    return res.status(503).json({ error: 'Cashfree verification not configured' });
  }
  const pan = String(req.body?.pan ?? '').trim().toUpperCase();
  const name = req.body?.name ? String(req.body.name).trim() : undefined;
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return res.status(400).json({ error: 'Invalid PAN format' });
  }
  const base = cfg.cashfreeVerifyEnv === 'sandbox'
    ? 'https://sandbox.cashfree.com'
    : 'https://api.cashfree.com';
  try {
    const cf = await fetch(`${base}/verification/pan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': cfg.cashfreeVerifyClientId,
        'x-client-secret': cfg.cashfreeVerifySecret,
      },
      body: JSON.stringify(name ? { pan, name } : { pan }),
    });
    const data = (await cf.json().catch(() => ({}))) as Record<string, unknown>;
    if (!cf.ok) {
      return res.status(cf.status).json({ valid: false, error: (data.message as string) || 'PAN verification failed' });
    }
    const valid = data.valid === true;
    res.json({
      valid,
      registered_name: valid ? ((data.registered_name as string) || (data.name_provided as string) || null) : null,
      message: (data.message as string) ?? null,
    });
  } catch (e) {
    console.error('[verify/pan] error', (e as Error)?.message);
    res.status(502).json({ valid: false, error: 'Verification service unavailable' });
  }
});

app.use(requireSupabaseUser);

/* ----------------------------- scheme master ------------------------------ */

/**
 * Fields requested from BSE — trims the payload ~16x vs fields:["ALL"]
 * (verified on the demo: 19.3KB -> 1.2KB per row).
 */
const SCHEME_FIELDS = [
  'name', 'scheme_bse_code', 'scheme_amc_name', 'scheme_category',
  'scheme_sub_category', 'scheme_isin', 'scheme_plan', 'scheme_option',
  'scheme_benchmark', 'scheme_exit_load', 'scheme_exit_load_remarks',
  'scheme_offer_status', 'is_active',
];

/** 28k schemes change rarely — cache mapped pages for 6h. */
const SCHEME_TTL_MS = 6 * 60 * 60 * 1000;
const schemeCache = new Map<string, { at: number; rows: ReturnType<typeof toAppScheme>[] }>();

async function fetchSchemes(search: string, limit: number) {
  const key = `${search}|${limit}`;
  const hit = schemeCache.get(key);
  if (hit && Date.now() - hit.at < SCHEME_TTL_MS) return hit.rows;
  // Demo path verified 25-Jul-2026: /master_scheme_list (NOT /v2/...).
  const data = await bse.post<Record<string, unknown>>('/master_scheme_list', {
    start: 0,
    length: limit,
    fields: SCHEME_FIELDS,
    count_only: false,
    ...(search ? { search: { value: search } } : {}),
  });
  const rows = ((data.lists ?? data.list ?? []) as Record<string, unknown>[]).map(toAppScheme);
  schemeCache.set(key, { at: Date.now(), rows });
  return rows;
}

/** Scheme master → app FundScheme[]. Optional ?q= substring, ?limit= (max 2000). */
app.get('/schemes', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
    res.json(await fetchSchemes(q, limit));
  } catch (err) {
    next(err);
  }
});

app.get('/schemes/:code', async (req, res, next) => {
  try {
    // BSE search is substring ("007-DP" also matches "IC9007-DP") — fetch a
    // page and pick the exact scheme_bse_code match.
    const code = req.params.code;
    const rows = await fetchSchemes(code, 20);
    res.json(rows.find((r) => r.schemeCode === code) ?? null);
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

/* --------------------------------- UCC ------------------------------------ */

/**
 * UCC registration. Verified live on the demo (30-Jul-2026) — a physical
 * resident-individual UCC registered and returned status APPROVED, then settled
 * to PENDING_AUTH pending the investor's 2FA (see /ucc/2fa-link below).
 */
app.post('/ucc', async (req, res, next) => {
  try {
    const body = req.body as AppUccRequest;
    const result = await bse.post<Record<string, unknown>>(
      '/v2/add_ucc',
      toAddUcc(body, cfg.bseMemberCode),
    );
    res.json(toAppUccResult(result, body.clientCode));
  } catch (err) {
    next(err);
  }
});

/** Current UCC status (PENDING_AUTH -> PENDING_VERIFICATION -> ACTIVE ...). */
app.get('/ucc/:clientCode', async (req, res, next) => {
  try {
    const result = await bse.post<Record<string, unknown>>('/v2/get_ucc', {
      investor: { client_code: req.params.clientCode },
      fields: ['ALL'],
    });
    res.json(toAppUccResult(result, req.params.clientCode));
  } catch (err) {
    next(err);
  }
});

/**
 * Investor 2FA link. BSE requires the INVESTOR to approve onboarding/txns on a
 * BSE-hosted page; we hand the URL to the client. NOTE this endpoint's envelope
 * is an ARRAY (not the usual object) and events are lowercase — both verified
 * live; `UCC_ELOG` (as printed in the docs) returns record_not_found.
 */
app.post('/ucc/2fa-link', async (req, res, next) => {
  try {
    const { clientCode, event } = req.body as { clientCode: string; event?: string };
    const rows = await bse.postRaw<Record<string, unknown>[]>('/v2/get_2fa_link', [
      {
        event: event ?? 'ucc_auth',
        investor: { client_code: clientCode, pan_holder: [''], holding_nature: '' },
        parent_client_code: '',
        member_code: cfg.bseMemberCode,
      },
    ]);
    const links = (rows ?? []).flatMap((r) => {
      const action = (r.action ?? {}) as Record<string, unknown>;
      const objs = (action.event_object ?? []) as Record<string, unknown>[];
      return objs.map((o) => ({
        event: String(action.event ?? ''),
        pan: String(o.pan ?? ''),
        holderRank: String(o.holder_rank ?? ''),
        url: String(o['2fa_url'] ?? ''),
      }));
    });
    res.json({ clientCode, links, isMock: false });
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
