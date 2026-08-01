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
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import { BseClient, BseError } from './bseClient.js';
import { webhookRouter } from './webhooks.js';
import { casRouter } from './cas/import.js';
import { casRequestRouter } from './cas/requests.js';
import { lastNavRefresh, refreshNavs } from './cas/nav.js';
import {
  toAppOrderResult,
  toAppScheme,
  toAppTxnResult,
  toOrderNew,
  toRedemption,
  toSwitch,
  toSxpRegister,
  toAddUcc,
  toMandateRegister,
  toSxpRegister2,
  toAppSxpResult,
  type AppSxpRequest,
  toAppMandateResult,
  type AppMandateRequest,
  toAppUccResult,
  type AppUccRequest,
  type AppOrderRequest,
  type AppRedemptionRequest,
  type AppSwitchRequest,
  type AppMemDetails,
} from './mappers.js';

const cfg = loadConfig();
const bse = new BseClient(cfg);
const app = express();

// 10mb, not 1mb: UCC registration carries supporting documents (cancelled
// cheque, AOF) inline as base64, and base64 inflates by a third. Callers are
// capped at 3mb per document, so two documents plus the payload fit inside it.
app.use(express.json({ limit: '10mb' }));
app.use(
  cors({
    origin: cfg.allowedOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

/* ------------------------- caller authentication -------------------------- */

/**
 * Who is calling, and what they are allowed to touch.
 *
 * Staff (an nw_employees row) may act on any UCC — that is the MF Admin
 * console. A client may act on exactly one: their own. Anyone else is refused.
 */
interface Caller {
  kind: 'staff' | 'client';
  authUserId: string;
  /** Clients only. The ONLY UCC this caller may read or transact on. */
  ucc: string | null;
  clientId?: string;
  /** Staff only — stamped on records they create on a client's behalf. */
  employeeId?: string | null;
  /**
   * The EUIN to stamp on transactions this caller places. Staff carry their
   * own; a client placing their own order has none and takes the default.
   */
  euin?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      caller?: Caller;
    }
  }
}

/** Query Supabase with the service role — used only to identify the caller. */
async function sbSelect(path: string): Promise<Record<string, unknown>[]> {
  if (!cfg.supabaseServiceRoleKey) return [];
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: cfg.supabaseServiceRoleKey,
      Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
    },
  });
  if (!r.ok) return [];
  return (await r.json()) as Record<string, unknown>[];
}

/**
 * Resolve the bearer token to a Caller.
 *
 * A valid JWT alone is NOT authorization — that was the old gate, and it was
 * safe only because every caller was a vetted admin. Clients transacting makes
 * it a hole: without resolving identity, any signed-in user could pass any
 * clientCode and act on another person's account.
 */
async function requireCaller(req: Request, res: Response, next: NextFunction) {
  if (!cfg.requireAuth) {
    req.caller = { kind: 'staff', authUserId: 'auth-disabled', ucc: null };
    return next();
  }
  const auth = req.header('authorization');
  const jwt = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return res.status(401).json({ error: 'Missing bearer token' });

  let authUserId: string;
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: cfg.supabaseAnonKey },
    });
    if (!r.ok) return res.status(401).json({ error: 'Invalid session' });
    authUserId = String(((await r.json()) as { id?: string }).id ?? '');
    if (!authUserId) return res.status(401).json({ error: 'Invalid session' });
  } catch {
    return res.status(502).json({ error: 'Auth verification unavailable' });
  }

  // Staff first — the MF Admin console keeps full reach.
  const staff = await sbSelect(
    `nw_employees?select=id,euin&status=eq.active&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`,
  );
  if (staff.length) {
    req.caller = {
      kind: 'staff',
      authUserId,
      ucc: null,
      euin: (staff[0].euin as string) || null,
      employeeId: (staff[0].id as string) || null,
    };
    return next();
  }

  // Otherwise a portal client, scoped to their own UCC.
  const client = await sbSelect(
    `nw_clients?select=id,bse_ucc&client_auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`,
  );
  if (client.length) {
    req.caller = {
      kind: 'client',
      authUserId,
      ucc: (client[0].bse_ucc as string) || null,
      clientId: String(client[0].id ?? ''),
    };
    return next();
  }

  return res.status(403).json({ error: 'This account is not permitted to use the BSE service.' });
}

/**
 * The UCC a request may act on.
 *
 * For a client the answer never comes from the request body — it is read from
 * their own record. A client may therefore ask for someone else's UCC and
 * simply get their own; there is no code path that honours the request.
 */
function scopedUcc(req: Request, requested?: string | null): string {
  const c = req.caller;
  if (!c) throw new BseError('Caller not resolved', 401);
  if (c.kind === 'staff') {
    const ucc = (requested ?? '').trim();
    if (!ucc) throw new BseError('A client code is required.', 400);
    return ucc;
  }
  if (!c.ucc) {
    throw new BseError(
      'Your investment account is not set up yet. Please contact your relationship manager.',
      403,
    );
  }
  return c.ucc;
}

/**
 * The EUIN to stamp on a transaction: the signed-in employee's, falling back to
 * the configured default when they hold none or when a client is placing their
 * own order from the portal. Never empty — SEBI expects an EUIN declaration on
 * every distributor-executed transaction.
 *
 * The ARN is not sent; BSE derives it from the member record.
 */
function mem(req: Request): AppMemDetails {
  return { euin: req.caller?.euin || cfg.bseDefaultEuin };
}

/* --------------------------------- routes --------------------------------- */

/**
 * Optional feature routers, recorded AS THEY MOUNT.
 *
 * Exists because "is the new build actually running?" was not answerable from
 * outside this box. Every route sits behind the Supabase-JWT gate, which runs
 * before route matching, so an unauthenticated probe of a real route and of a
 * route that does not exist both answer 401 — identically. The only way to tell
 * a deployed build from a stale one was to log into the server.
 *
 * Recorded through this helper rather than as a hand-written list so /health
 * cannot advertise a feature that failed to mount: the mounting IS the
 * registration.
 */
const mountedFeatures: string[] = [];

function mountFeature(path: string, name: string, router: Router): void {
  app.use(path, router);
  mountedFeatures.push(name);
}

/** When this process came up — a restart after deploying is visible here. */
const startedAt = new Date().toISOString();

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    env: cfg.bseEnv,
    ts: new Date().toISOString(),
    startedAt,
    // Public on purpose: names of mounted routes, nothing about what they do.
    features: mountedFeatures,
    /*
     * A NAV feed that quietly stops is worse than one that is plainly missing —
     * the client keeps seeing a figure that looks current. Surfacing the last
     * run here is what makes a stalled job noticeable without logging in.
     */
    nav: await lastNavRefresh(cfg),
  });
});

/**
 * Nightly NAV refresh, called by the droplet's own cron.
 *
 * Sits BEFORE the Supabase-JWT gate and authenticates with a shared secret,
 * because cron has no user session — the same shape as /verify/pan. AMFI
 * publishes once a day after the close, so this is scheduled, never polled.
 */
app.post('/nav/refresh', async (req, res) => {
  if (!cfg.navRefreshSecret) {
    return res.status(503).json({ error: 'NAV refresh is not configured on this server.' });
  }
  if (req.header('x-nav-secret') !== cfg.navRefreshSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await refreshNavs(cfg);
  return res.status(result.ok ? 200 : 502).json(result);
});

// Public — BSE calls this, so it must sit BEFORE the Supabase-JWT gate.
mountFeature('/webhooks', 'webhooks', webhookRouter(cfg));

/**
 * Cashfree PAN verification relay. Called server-to-server by the Supabase edge
 * function (public-pan-verify) with a shared secret — NOT a Supabase JWT — so it
 * sits before the JWT gate. The whole point of routing through this droplet is
 * that Cashfree only accepts calls from this box's whitelisted static IP.
 * The edge function keeps all app logic (ownership, dedup, DB write); this route
 * is a thin pass-through that adds the static IP + holds the Cashfree keys.
 */
/**
 * Verify a PAN with Cashfree and return the name it is registered under.
 *
 * Shared by two routes with different callers: /verify/pan (Supabase edge
 * functions, authenticated by a relay secret) and /pan/verify (the MF Admin
 * console, authenticated by the employee's session). Same logic, so the two
 * can never disagree about whether a PAN is valid.
 */
async function verifyPanWithCashfree(
  pan: string,
  name?: string,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  if (!cfg.cashfreeVerifyClientId || !cfg.cashfreeVerifySecret) {
    return { ok: false, status: 503, body: { error: 'Cashfree verification not configured' } };
  }
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return { ok: false, status: 400, body: { error: 'Invalid PAN format' } };
  }
  const base =
    cfg.cashfreeVerifyEnv === 'sandbox'
      ? 'https://sandbox.cashfree.com'
      : 'https://api.cashfree.com';
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
    return {
      ok: false,
      status: cf.status,
      body: { valid: false, error: (data.message as string) || 'PAN verification failed' },
    };
  }
  const valid = data.valid === true || String(data.pan_status ?? '').toUpperCase() === 'VALID';
  return {
    ok: true,
    status: 200,
    body: {
      valid,
      registered_name: valid ? (data.registered_name ?? data.name_provided ?? null) : null,
      message: data.message ?? null,
    },
  };
}

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

/**
 * BSE answers order_new with {"status":"success","data":{}} — no id, nothing
 * created — when it silently refuses an order (UCC not transaction-ready,
 * scheme/mode mismatch, or a payload it could not use). Treating that as
 * success would tell a client their money moved when it did not.
 */
function assertOrderPlaced(result: Record<string, unknown>, what: string): void {
  const items = (result.items as Record<string, unknown>[] | undefined) ?? [];
  const id = String(items[0]?.id ?? result.id ?? result.order_id ?? '');
  if (!id) {
    throw new BseError(
      `BSE returned success but no order id — the ${what} was NOT placed. Common causes: ` +
        'the folio does not exist, the UCC is not transaction-ready, or the scheme does not ' +
        'allow this mode (physical vs demat).',
      502,
      result,
    );
  }
}

/** Routes a portal client must never reach. */
function staffOnly(req: Request, res: Response, next: NextFunction) {
  if (req.caller?.kind !== 'staff') {
    return res.status(403).json({ error: 'Staff only.' });
  }
  next();
}

/**
 * Confirm a record identified only by its BSE id belongs to the caller.
 *
 * Ids like sxp_reg_num and exch_mandate_id carry no owner, so a client could
 * otherwise cancel someone else's SIP or read their mandate simply by knowing
 * a number. Staff skip the check; a client must match on UCC.
 */
async function assertOwnsByUcc(req: Request, ownerUcc: string | null | undefined, what: string) {
  const c = req.caller;
  if (!c || c.kind === 'staff') return;
  if (!c.ucc || String(ownerUcc ?? '') !== c.ucc) {
    throw new BseError(`That ${what} does not belong to your account.`, 403);
  }
}

/**
 * The BSE-hosted link the INVESTOR must approve for a transaction to proceed.
 *
 * BSE requires per-transaction approval, so an order that is "placed" but never
 * approved simply never happens. Fetching the link at placement means the
 * client sees it while they are still on the screen, instead of discovering
 * days later that nothing moved. Best-effort: the order is already placed, so a
 * missing link must not turn a success into an error.
 */
async function fetchTwoFaUrl(event: string, key: 'order' | 'sxp', id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const rows = await bse.postRaw<Record<string, unknown>[]>('/v2/get_2fa_link', [
      { event, [key]: String(id), member_code: cfg.bseMemberCode },
    ]);
    const action = ((rows ?? [])[0]?.action ?? {}) as Record<string, unknown>;
    const objs = (action.event_object ?? []) as Record<string, unknown>[];
    return (objs[0]?.['2fa_url'] as string) ?? null;
  } catch {
    return null;
  }
}

app.use(requireCaller);

/* ------------------------- Portfolio import (CAS) -------------------------- */

/**
 * Importing a client's own Consolidated Account Statement. Nothing to do with
 * BSE — it sits here because this is the Node host that holds the service-role
 * key, and a CAS must never leave our infrastructure to be parsed.
 *
 * Mounted through mountFeature so GET /health reports it — the only way to
 * confirm from outside that a droplet is running a build containing this route.
 */
mountFeature('/cas', 'cas', casRouter(cfg));
// Tracking around the import: intent, consent and status. Deliberately separate
// from /cas/import, which is the pipeline itself and stays untouched.
mountFeature('/cas/requests', 'cas_requests', casRequestRouter(cfg));

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
  // Nested blocks the console's order form gates on: which modes the scheme
  // accepts (physical vs demat) and per-transaction min/max + cut-off times.
  'scheme_transaction_mode_allowed', 'lumpsum',
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

/**
 * Lumpsum purchase, or a SIP (routed to SXP registration).
 *
 * SAFETY — do not remove: BSE's /order_new answers `{"status":"success",
 * "data":{}}` with NO order id and creates NOTHING when the UCC is not
 * transaction-ready (verified live 30-Jul-2026 against order_list, which showed
 * zero orders). A bare `status: success` therefore does NOT mean the order was
 * placed. We require a real order id and fail loudly otherwise, so we can never
 * report a phantom order to a client who has paid.
 */
app.post('/order', async (req, res, next) => {
  try {
    const body = req.body as AppOrderRequest & { schemeName?: string };
    // A client's UCC comes from their own record; any clientCode they sent is ignored.
    body.clientCode = scopedUcc(req, body.clientCode);
    if (body.type === 'sip') {
      const sxp = await bse.post<Record<string, unknown>>(
        '/sxp_register',
        toSxpRegister(body, cfg.bseMemberCode, mem(req)),
      );
      const regNum = String(sxp.sxp_id ?? sxp.sxp_reg_num ?? sxp.id ?? '');
      if (!regNum) {
        throw new BseError('BSE accepted the SIP but returned no registration number', 502, sxp);
      }
      const sipTwoFa = await fetchTwoFaUrl('verify_sxp_reg', 'sxp', regNum);
      return res.json({
        ...toAppOrderResult({ ...sxp, id: regNum }, body, body.schemeName ?? body.schemeCode),
        twoFaUrl: sipTwoFa,
      });
    }
    // NOTE: /order_new — NOT /v2/order_new, which 404s on the live platform.
    // VERIFIED LIVE: order_new wraps orders in an ARRAY under `orders`. Sending
    // a bare order object returns {"status":"success","data":{}} and silently
    // places NOTHING — which is the trap the guard below exists for.
    const result = await bse.post<Record<string, unknown>>('/order_new', {
      orders: [toOrderNew(body, cfg.bseMemberCode, mem(req))],
    });
    const items = (result.items as Record<string, unknown>[] | undefined) ?? [];
    const orderId = String(items[0]?.id ?? result.id ?? result.order_id ?? '');
    if (!orderId) {
      throw new BseError(
        'BSE returned success but no order id — the order was NOT placed. Common causes: ' +
          'the UCC is not transaction-ready, the scheme does not allow this mode ' +
          '(physical vs demat), or a malformed payload BSE swallowed silently.',
        502,
        result,
      );
    }
    const twoFaUrl = await fetchTwoFaUrl('verify_order_new', 'order', orderId);
    res.json({
      ...toAppOrderResult(result, body, body.schemeName ?? body.schemeCode),
      twoFaUrl,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/redemption', async (req, res, next) => {
  try {
    const body = req.body as AppRedemptionRequest;
    body.clientCode = scopedUcc(req, body.clientCode);
    const result = await bse.post<Record<string, unknown>>('/order_new', {
      orders: [toRedemption(body, cfg.bseMemberCode, mem(req))],
    });
    assertOrderPlaced(result, 'redemption');
    const detail =
      body.mode === 'all' ? `Full redemption · ${body.units.toFixed(3)} units` : `₹${body.amount} redeemed`;
    const txnTwoFa = await fetchTwoFaUrl('verify_order_new', 'order', String(((result.items as Record<string, unknown>[] | undefined) ?? [])[0]?.id ?? ''));
    res.json({ ...toAppTxnResult(result, 'redeem', body.schemeName, detail, body.amount), twoFaUrl: txnTwoFa });
  } catch (err) {
    next(err);
  }
});

app.post('/switch', async (req, res, next) => {
  try {
    const body = req.body as AppSwitchRequest;
    body.clientCode = scopedUcc(req, body.clientCode);
    const result = await bse.post<Record<string, unknown>>('/order_new', { orders: [toSwitch(body, cfg.bseMemberCode, mem(req))] });
    assertOrderPlaced(result, 'switch');
    res.json(
      toAppTxnResult(result, 'switch', body.fromSchemeName, `Switched ₹${body.amount} to ${body.toSchemeName}`, body.amount),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Cancel an open order. Verified live 30-Jul-2026: the payload needs the
 * investor block and member alongside the id, and BSE answers
 * { success_id: [...] } — but the order does NOT move to cancelled until the
 * INVESTOR approves a `verify_order_cancel` 2FA link, which we return here.
 */
app.post('/cancel', async (req, res, next) => {
  try {
    const { orderId } = req.body as { orderId: string };
    const clientCode = scopedUcc(req, (req.body as { clientCode?: string }).clientCode);
    if (req.caller?.kind === 'client') {
      const list = await bse.post<Record<string, unknown>>('/order_list', {
        start: 0, length: 500, fields: ['ALL'], count_only: false,
        filter_param: { open_close: 'o' },
      });
      const rows = ((list.lists ?? list.list ?? []) as Record<string, unknown>[]) || [];
      const hit = rows.find((r) => String(r.id ?? '') === String(orderId));
      await assertOwnsByUcc(req, (hit?.investor as Record<string, unknown>)?.ucc as string, 'order');
    }
    const result = await bse.post<Record<string, unknown>>('/order_cancel', {
      id: Number(orderId) || orderId,
      investor: { ucc: clientCode },
      member: cfg.bseMemberCode,
    });
    const accepted = ((result.success_id as unknown[]) ?? []).length > 0;
    if (!accepted) {
      throw new BseError('BSE did not accept the cancellation', 502, result);
    }
    // Fetch the investor's 2FA link so the caller can surface it immediately.
    let twoFaUrl: string | null = null;
    try {
      const rows = await bse.postRaw<Record<string, unknown>[]>('/v2/get_2fa_link', [
        { event: 'verify_order_cancel', order: String(orderId), member_code: cfg.bseMemberCode },
      ]);
      const action = ((rows ?? [])[0]?.action ?? {}) as Record<string, unknown>;
      const objs = (action.event_object ?? []) as Record<string, unknown>[];
      twoFaUrl = (objs[0]?.['2fa_url'] as string) ?? null;
    } catch {
      /* link is best-effort — the cancellation request itself succeeded */
    }
    res.json({
      orderId,
      status: 'CANCEL_PENDING_INVESTOR_2FA',
      twoFaUrl,
      isMock: false,
    });
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
/**
 * BSE rejects a malformed nomination set with a generic error, and a UCC that
 * gets that far has already consumed its client code. Checking here — the one
 * place every caller goes through — fails fast with something actionable.
 */
const MAX_DOC_BYTES = 3 * 1024 * 1024;

function assertUccPayload(body: AppUccRequest) {
  const nominees = body.nominees ?? [];
  if (nominees.length > 3) {
    throw new BseError('BSE allows at most 3 nominees.', 400);
  }
  if (nominees.length > 0) {
    const total = nominees.reduce((sum, n) => sum + Number(n.percent || 0), 0);
    if (total !== 100) {
      throw new BseError(
        `Nomination percentages must total exactly 100 — they currently total ${total}.`,
        400,
      );
    }
    const minorWithoutGuardian = nominees.find((n) => n.isMinor && !n.guardian?.pan);
    if (minorWithoutGuardian) {
      throw new BseError(
        `${minorWithoutGuardian.firstName} is a minor, so a guardian with a PAN is required.`,
        400,
      );
    }
  }
  for (const [label, doc] of [
    ['Bank proof', body.documents?.bankProof],
    ['Account opening form', body.documents?.aof],
  ] as const) {
    if (doc && doc.fileSize > MAX_DOC_BYTES) {
      throw new BseError(`${label} is larger than the 3 MB limit.`, 400);
    }
  }
}

app.post('/ucc', staffOnly, async (req, res, next) => {
  try {
    const body = req.body as AppUccRequest;
    assertUccPayload(body);
    const result = await bse.post<Record<string, unknown>>(
      '/v2/add_ucc',
      toAddUcc(body, cfg.bseMemberCode),
    );
    res.json(toAppUccResult(result, body.clientCode));
  } catch (err) {
    next(err);
  }
});

/**
 * Current UCC status plus the full verification breakdown.
 *
 * BSE nests each check inside ucc_status_object; flattening it here is what
 * lets the console answer "why is this client not ACTIVE yet?" without every
 * page having to know BSE's shape. Per BSE's webhook docs, bank verification
 * does NOT block activation, and FATCA can sit PENDING on an ACTIVE UCC —
 * both are surfaced but marked non-blocking so staff don't chase them.
 */
app.get('/ucc/:clientCode', async (req, res, next) => {
  try {
    const clientCode = scopedUcc(req, req.params.clientCode);
    const result = await bse.post<Record<string, unknown>>('/v2/get_ucc', {
      investor: { client_code: clientCode },
      fields: ['ALL'],
    });
    const so = (result.ucc_status_object as Record<string, unknown>) ?? {};
    const holder = ((so.holders as Record<string, unknown>[]) ?? [{}])[0] ?? {};
    const txnReady = ((so.transaction_ready as Record<string, unknown>[]) ?? [{}])[0] ?? {};

    /** BSE reports state as "TRUE"/"FALSE"/""/PENDING across different keys. */
    const state = (v: unknown): 'pass' | 'fail' | 'pending' => {
      const s = String(v ?? '').toUpperCase();
      if (s === 'TRUE') return 'pass';
      if (s === 'FALSE') return 'fail';
      return 'pending';
    };
    const check = (
      key: string,
      label: string,
      raw: Record<string, unknown> | undefined,
      blocking: boolean,
      statusKey = 'verified_status',
    ) => ({
      key,
      label,
      blocking,
      state: state(raw?.[statusKey]),
      reason: String(raw?.verification_failed_reason ?? ''),
      at: String(raw?.verified_at ?? raw?.accepted_at ?? ''),
    });

    const fatca = (holder.fatca_status as Record<string, unknown>[]) ?? [];
    const checks = [
      check('pan', 'PAN verification', holder.pan_verification as Record<string, unknown>, true),
      check('kyc', 'KYC (KRA/CKYC)', holder.kyc_status as Record<string, unknown>, true),
      check('elog', 'Investor e-log / AOF', holder.elog as Record<string, unknown>, true, 'status'),
      check('nominee', 'Nominee authorisation', holder.nominee_2fa as Record<string, unknown>, true),
      ...fatca.map((f, i) =>
        check(`fatca_${i}`, `FATCA · ${String(f.rta_type ?? 'RTA')}`, f, false),
      ),
      ...(((so.bank_account as Record<string, unknown>[]) ?? []).map((b, i) =>
        // Explicitly non-blocking: BSE's webhook doc states bank verification
        // does not affect activation.
        check(`bank_${i}`, `Bank ${String(b.bank_acc_num ?? '')}`, b, false),
      )),
    ];

    res.json({
      ...toAppUccResult(result, clientCode),
      transactionReady: state(txnReady.verified_status) === 'pass',
      transactionReadyReason: String(txnReady.verification_failed_reason ?? ''),
      mode: String(txnReady.mode ?? ''),
      pan: String(holder.holder_pan ?? ''),
      checks,
      blockedBy: checks.filter((c) => c.blocking && c.state !== 'pass').map((c) => c.label),
    });
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
    const { event } = req.body as { event?: string };
    const clientCode = scopedUcc(req, (req.body as { clientCode?: string }).clientCode);
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

/* ------------------------------- Mandates --------------------------------- */

/**
 * Register a mandate (auto-debit authority) — required before SIPs can run.
 * Verified live 30-Jul-2026 for both E-NACH and UPI.
 */
app.post('/mandate', async (req, res, next) => {
  try {
    const body = req.body as AppMandateRequest;
    body.clientCode = scopedUcc(req, body.clientCode);
    const result = await bse.post<Record<string, unknown>>(
      '/mandate_register',
      toMandateRegister(body, cfg.bseMemberCode),
    );
    res.json(toAppMandateResult(result));
  } catch (err) {
    next(err);
  }
});

/** Single mandate by BSE id. `exch_mandate_id` must be a NUMBER, not a string. */
app.get('/mandate/:mandateId', async (req, res, next) => {
  try {
    const result = await bse.post<Record<string, unknown>>('/mandate_get', {
      exch_mandate_id: Number(req.params.mandateId),
    });
    await assertOwnsByUcc(req, result.ucc as string, 'mandate');
    res.json({ ...toAppMandateResult(result), raw: result });
  } catch (err) {
    next(err);
  }
});

/** All mandates, newest first — optionally filtered to one client. */
app.get('/mandates', async (req, res, next) => {
  try {
    const clientCode =
      req.caller?.kind === 'client'
        ? (req.caller.ucc ?? '\u0000') // no UCC => matches nothing, never everything
        : typeof req.query.clientCode === 'string'
          ? req.query.clientCode
          : null;
    const result = await bse.post<Record<string, unknown>>('/mandate_list', {
      start: 0,
      length: 200,
      fields: ['ALL'],
      count_only: false,
    });
    const rows = ((result.lists ?? result.list ?? []) as Record<string, unknown>[]) || [];
    const mapped = rows
      .filter((r) => !clientCode || String(r.ucc ?? '') === clientCode)
      .map((r) => ({
        mandateId: String(r.exch_mandate_id ?? ''),
        clientCode: String(r.ucc ?? ''),
        amount: Number(r.amount ?? 0),
        bank: { name: String(r.bank_name ?? ''), ifsc: String(r.ifsc ?? ''), accountNumber: String(r.acct_no ?? '') },
        mode: String(r.mode ?? ''),
        umrn: String(r.umrn ?? ''),
        isVerified: Boolean(r.is_verified),
        isActive: Boolean(r.is_active),
        validTill: String(r.valid_till ?? ''),
        isMock: false,
      }));
    res.json(mapped);
  } catch (err) {
    next(err);
  }
});

/**
 * Hand back BSE's hosted payment page for one or more placed orders.
 *
 * `get_exchpg_service` is the entry point, NOT `send_payment_info`. That
 * distinction cost us a long detour: driving send_payment_info directly returns
 * errcode `not_allowed` on field `member`, which read as "member 66899 is not
 * entitled to the payment gateway". It is not — it is the inner call, and it
 * expects bank/VPA details we do not hold. Asking get_exchpg_service for a page
 * link works on the same member code, and produces the same "Check Orders and
 * Make Payment" screen BSE shows in its own portal.
 *
 * Two request shapes (§6.2.13.1), both verified live on demo:
 *   requested_method 'exch_pg_page'      -> data.exch_pg_page_link
 *   requested_method 'payment_info_data' -> data.payment_information[] (modes
 *                                           plus the investor's bank rows)
 *
 * Sequencing: BSE answers `record_not_found` until the INVESTOR has approved
 * the order (it carries mem_2fa 'p' until then, moving to 'd' and status
 * payment_pending once approved). Payment is the step AFTER approval, never
 * parallel with it.
 *
 * If the client has no verified bank account on their UCC, the modes come back
 * with `get_bank_account_details_row: null` and BSE's page offers no bank to
 * pick — so `banks` is surfaced here rather than swallowed, and the caller can
 * say why the page looks empty.
 */
app.post('/payment/link', async (req, res, next) => {
  try {
    const body = req.body as {
      clientCode?: string;
      orderIds?: (string | number)[];
      returnUrl?: string;
    };
    const ucc = scopedUcc(req, body.clientCode);
    const orderIds = (body.orderIds ?? []).map((id) => Number(id)).filter((n) => Number.isFinite(n));
    if (!orderIds.length) throw new BseError('At least one order id is required.', 400);

    const m = mem(req);
    const base = {
      mem_details: {
        member: cfg.bseMemberCode,
        euin: m.euin,
        euin_flag: true,
        sub_br_code: '',
        sub_br_arn: '',
        partner_id: '',
      },
      investor: { ucc },
      order_ids: orderIds,
      payment_mode: ['upi', 'netbanking', 'mandate'],
      ...(body.returnUrl ? { redirection_url: body.returnUrl } : {}),
    };

    const page = await bse.post<Record<string, unknown>>('/get_exchpg_service', {
      ...base,
      requested_method: 'exch_pg_page',
    });

    const paymentUrl = String(page.exch_pg_page_link ?? '');
    if (!paymentUrl) {
      throw new BseError(
        'BSE did not return a payment page for these orders. The usual cause is that ' +
          'the investor has not approved them yet — payment is only available once the ' +
          '2FA approval is complete.',
        502,
        page,
      );
    }

    // Which modes the investor can actually use. Best-effort: a page link is
    // the thing that matters, and losing the mode list must not fail the call.
    let modes: { mode: string; label: string; banks: number }[] = [];
    try {
      const info = await bse.post<Record<string, unknown>>('/get_exchpg_service', {
        ...base,
        requested_method: 'payment_info_data',
      });
      const rows = (info.payment_information as Record<string, unknown>[] | undefined) ?? [];
      modes = rows.map((r) => ({
        mode: String(r.payment_mode ?? ''),
        label: String(r.mode_additional_info ?? r.payment_mode ?? ''),
        banks: ((r.get_bank_account_details_row as unknown[] | null) ?? []).length,
      }));
    } catch {
      /* page link already obtained — the mode list is a nicety */
    }

    res.json({
      paymentUrl,
      modes,
      /** True when no mode has a bank row — BSE's page will have nothing to offer. */
      noBankOnFile: modes.length > 0 && modes.every((x) => x.banks === 0),
      isMock: false,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/payment/status', async (req, res, next) => {
  try {
    const { orderId } = req.body as { orderId: string };
    // Order ids are guessable; make sure this one is the caller's.
    if (req.caller?.kind === 'client') {
      const list = await bse.post<Record<string, unknown>>('/order_list', {
        start: 0, length: 500, fields: ['ALL'], count_only: false,
        filter_param: { open_close: 'o' },
      });
      const rows = ((list.lists ?? list.list ?? []) as Record<string, unknown>[]) || [];
      const hit = rows.find((r) => String(r.id ?? '') === String(orderId));
      await assertOwnsByUcc(req, (hit?.investor as Record<string, unknown>)?.ucc as string, 'order');
    }
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

/**
 * PAN verification for the console's client-onboarding form.
 *
 * Sits behind the employee-session gate (this is registered after
 * requireSupabaseUser), unlike /verify/pan which serves edge functions with a
 * relay secret. Returning the name a PAN is registered under matters: BSE's own
 * KYC check compares the holder name against exactly this, so onboarding with a
 * name that differs is the difference between ACTIVE and stuck.
 */
app.post('/pan/verify', staffOnly, async (req, res, next) => {
  try {
    const pan = String(req.body?.pan ?? '').trim().toUpperCase();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const out = await verifyPanWithCashfree(pan, name);
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
});

/* --------------------------- Ops / diagnostics ---------------------------- */

/**
 * BSE's own callbacks, newest first — the audit trail of what BSE told us.
 * Served through the proxy (which owns the table and the service-role key) so
 * the console keeps reading only one backend.
 */
app.get('/webhooks/events', staffOnly, async (req, res, next) => {
  try {
    if (!cfg.supabaseServiceRoleKey) return res.json([]);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const r = await fetch(
      `${cfg.supabaseUrl}/rest/v1/bse_webhook_events` +
        `?select=received_at,event_type,event,client_code,order_id,sxp_reg_num,mandate_id,msgcode,request_id` +
        `&order=received_at.desc&limit=${limit}`,
      {
        headers: {
          apikey: cfg.supabaseServiceRoleKey,
          Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
        },
      },
    );
    if (!r.ok) throw new BseError(`Event store unavailable (${r.status})`, 502);
    return res.json(await r.json());
  } catch (err) {
    return next(err);
  }
});

/**
 * Our outbound IP — the one BSE whitelists, so worth showing plainly. Cached
 * for an hour (a droplet's IP does not move) and tried against several echo
 * services, since any single one can be down or rate-limited.
 */
let egressIpCache: { at: number; ip: string } | null = null;

async function resolveEgressIp(): Promise<string> {
  if (egressIpCache && Date.now() - egressIpCache.at < 60 * 60 * 1000) return egressIpCache.ip;
  const sources = ['https://ifconfig.me/ip', 'https://icanhazip.com', 'https://api.ipify.org'];
  for (const url of sources) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) continue;
      const ip = (await r.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        egressIpCache = { at: Date.now(), ip };
        return ip;
      }
    } catch {
      /* try the next source */
    }
  }
  return '';
}

/**
 * Connection diagnostics for the console's Settings screen: which BSE we talk
 * to, as which member, from which egress IP (the one BSE whitelists), and
 * whether a login currently succeeds.
 */
app.get('/diagnostics', staffOnly, async (_req, res, next) => {
  try {
    const egressIp = await resolveEgressIp();

    let bseReachable = false;
    let bseError = '';
    try {
      await bse.post('/master_scheme_list', { start: 0, length: 1, fields: ['ALL'], count_only: true });
      bseReachable = true;
    } catch (err) {
      bseError = err instanceof Error ? err.message : 'unknown';
    }

    res.json({
      environment: cfg.bseEnv,
      bseBaseUrl: cfg.bseBaseUrl,
      memberCode: cfg.bseMemberCode,
      // Never the password — only whether one is configured.
      credentialsConfigured: Boolean(cfg.bseUsername && cfg.bsePassword),
      egressIp,
      bseReachable,
      bseError,
      webhookUrl: `${cfg.publicBaseUrl ?? ''}/webhooks/starmf`,
      webhookPersistence: Boolean(cfg.supabaseServiceRoleKey),
      requireAuth: cfg.requireAuth,
      allowedOrigins: cfg.allowedOrigins,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------- Read models for the console --------------------- */

/**
 * Order book. BSE splits orders into open ("o") and closed ("c") lists and
 * requires `open_close` INSIDE filter_param — so we fetch both and merge.
 */
app.get('/orders', async (req, res, next) => {
  try {
    const clientCode =
      req.caller?.kind === 'client'
        ? (req.caller.ucc ?? '\u0000') // no UCC => matches nothing, never everything
        : typeof req.query.clientCode === 'string'
          ? req.query.clientCode
          : null;
    const fetchSide = async (openClose: 'o' | 'c') => {
      const r = await bse.post<Record<string, unknown>>('/order_list', {
        start: 0,
        length: 200,
        fields: ['ALL'],
        count_only: false,
        filter_param: { open_close: openClose },
      });
      const list = ((r.lists ?? r.list ?? []) as Record<string, unknown>[]) || [];
      return list.map(
        (row): Record<string, unknown> => ({
          ...row,
          __side: openClose === 'o' ? 'open' : 'closed',
        }),
      );
    };
    const rows = [...(await fetchSide('o')), ...(await fetchSide('c'))];
    res.json(
      rows
        .filter((r) => !clientCode || String((r.investor as Record<string, unknown>)?.ucc ?? '') === clientCode)
        .map((r) => ({
          orderId: String(r.id ?? ''),
          memberRef: String(r.mem_ord_ref_id ?? ''),
          clientCode: String((r.investor as Record<string, unknown>)?.ucc ?? ''),
          // BSE gives us readable names alongside the codes — surface both so
          // the console doesn't force staff to decode scheme/UCC codes.
          clientName: String(r.ucc_full_name ?? ''),
          schemeCode: String(r.scheme ?? ''),
          schemeName: String(r.src_scheme_name ?? ''),
          amount: Number(r.amount ?? 0),
          type: String(r.type ?? ''),
          status: String(r.status ?? ''),
          side: String(r.__side ?? ''),
          folio: String(r.folio_num ?? r.folio ?? ''),
          // NOTE the field is `placed_at` (not created_at/order_date, which do
          // not exist — reading those made every order look undated).
          placedAt: String(r.placed_at ?? ''),
          // rta_remark / rejection_reason can be objects — only take plain
          // strings, otherwise we'd render "[object Object]" at staff.
          rejectionReason: [r.rta_remark, r.rejection_reason].find(
            (v) => typeof v === 'string' && v.trim() !== '',
          ) as string ?? '',
          isMock: false,
        }))
        .sort((a, b) => (a.orderId < b.orderId ? 1 : -1)),
    );
  } catch (err) {
    next(err);
  }
});

/** All UCCs registered under this member, with their verification status. */
app.get('/uccs', staffOnly, async (_req, res, next) => {
  try {
    const result = await bse.post<Record<string, unknown>>('/v2/list_ucc', {
      start: 0,
      length: 200,
      fields: ['ALL'],
      count_only: false,
      ucc_status: 'ALL',
    });
    const rows = ((result.lists ?? result.list ?? []) as Record<string, unknown>[]) || [];
    res.json(
      rows.map((r) => {
        const holder = ((r.holder as Record<string, unknown>[]) ?? [{}])[0] ?? {};
        const person = (holder.person as Record<string, unknown>) ?? {};
        const pan = ((holder.identifier as Record<string, unknown>[]) ?? []).find(
          (i) => i.identifier_type === 'pan',
        );
        return {
          clientCode: String((r.investor as Record<string, unknown>)?.client_code ?? ''),
          name: [person.first_name, person.middle_name, person.last_name]
            .filter(Boolean)
            .join(' '),
          pan: String(pan?.identifier_number ?? ''),
          status: String(r.ucc_status ?? ''),
          holdingNature: String(r.holding_nature ?? ''),
          isPanVerified: Boolean(holder.is_pan_verified),
          // A PAN-exempt holder has no PAN to verify, so "pending" would be a
          // permanent, misleading state on a compliance screen.
          isPanExempt: Boolean(holder.is_pan_exempt),
          isMock: false,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Client holdings, netted from the order book.
 *
 * BSE exposes no holdings/folio API to us — `get_mis_detail` exists but our
 * member tier is not entitled to it (errcode `authz`), and there is no
 * folio_list endpoint. So positions are derived: allotted purchases add units
 * on a (folio, scheme) pair, redemptions and switch-outs remove them.
 *
 * A folio only exists once an order is ALLOTTED, so an order still sitting at
 * "received" contributes nothing — which is why redemption and switch are
 * unavailable until settlement.
 */
app.get('/holdings', async (req, res, next) => {
  try {
    const clientCode =
      req.caller?.kind === 'client'
        ? (req.caller.ucc ?? '\u0000') // no UCC => matches nothing, never everything
        : typeof req.query.clientCode === 'string'
          ? req.query.clientCode
          : null;
    const fetchSide = async (openClose: 'o' | 'c') => {
      const r = await bse.post<Record<string, unknown>>('/order_list', {
        start: 0,
        length: 500,
        fields: ['ALL'],
        count_only: false,
        filter_param: { open_close: openClose },
      });
      return ((r.lists ?? r.list ?? []) as Record<string, unknown>[]) || [];
    };
    const rows = [...(await fetchSide('o')), ...(await fetchSide('c'))].filter(
      (r) => !clientCode || String((r.investor as Record<string, unknown>)?.ucc ?? '') === clientCode,
    );

    // key: ucc|folio|scheme
    const positions = new Map<
      string,
      {
        clientCode: string;
        folio: string;
        schemeCode: string;
        schemeName: string;
        units: number;
        invested: number;
        lastNav: number;
        lastDate: string;
      }
    >();

    const bump = (
      r: Record<string, unknown>,
      folio: string,
      units: number,
      amount: number,
      nav: number,
      date: string,
    ) => {
      if (!folio || !units) return;
      const ucc = String((r.investor as Record<string, unknown>)?.ucc ?? '');
      const schemeCode = String(r.scheme ?? '');
      const key = `${ucc}|${folio}|${schemeCode}`;
      const cur =
        positions.get(key) ??
        {
          clientCode: ucc,
          folio,
          schemeCode,
          schemeName: String(r.src_scheme_name ?? ''),
          units: 0,
          invested: 0,
          lastNav: 0,
          lastDate: '',
        };
      cur.units += units;
      cur.invested += amount;
      if (nav) cur.lastNav = nav;
      if (date && date > cur.lastDate) cur.lastDate = date;
      positions.set(key, cur);
    };

    for (const r of rows) {
      const allot = (r.allotment_details as Record<string, unknown>) ?? {};
      const redeem = (r.redempt_details as Record<string, unknown>) ?? {};
      if (allot.folio) {
        bump(
          r,
          String(allot.folio),
          Number(allot.allotment_units ?? 0),
          Number(allot.allotment_amount ?? 0),
          Number(allot.allotment_nav ?? 0),
          String(allot.allotment_date ?? ''),
        );
      }
      if (redeem.folio) {
        bump(
          r,
          String(redeem.folio),
          -Number(redeem.redempt_units ?? 0),
          -Number(redeem.redempt_amount ?? 0),
          Number(redeem.redempt_nav ?? 0),
          String(redeem.redempt_date ?? ''),
        );
      }
    }

    res.json(
      [...positions.values()]
        .filter((p) => p.units > 0) // fully exited positions are not redeemable
        .map((p) => ({
          ...p,
          units: Number(p.units.toFixed(3)),
          value: Number((p.units * (p.lastNav || 0)).toFixed(2)),
          isMock: false,
        }))
        .sort((a, b) => b.value - a.value),
    );
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- SXP ------------------------------------ */

/**
 * Register a systematic plan (SIP / SWP / STP / TOPUP). Endpoint is
 * /sxp_register — NOT under /v2. An XSIP needs `mandateId` (exch_mandate_id).
 * Requires a transaction-ready UCC; BSE otherwise returns errcode
 * incomplete_operation on field phys_ucc.
 */
app.post('/sxp', async (req, res, next) => {
  try {
    const body = req.body as AppSxpRequest;
    body.clientCode = scopedUcc(req, body.clientCode);
    const result = await bse.post<Record<string, unknown>>(
      '/sxp_register',
      toSxpRegister2(body, cfg.bseMemberCode, mem(req)),
    );
    const regNum = String(result.sxp_id ?? result.sxp_reg_num ?? result.id ?? '');
    if (!regNum) {
      throw new BseError('BSE returned success but no sxp_reg_num — nothing was registered', 502, result);
    }
    res.json(toAppSxpResult(result, body));
  } catch (err) {
    next(err);
  }
});

/** All systematic plans, optionally filtered to one client. */
app.get('/sxp', async (req, res, next) => {
  try {
    const clientCode =
      req.caller?.kind === 'client'
        ? (req.caller.ucc ?? '\u0000') // no UCC => matches nothing, never everything
        : typeof req.query.clientCode === 'string'
          ? req.query.clientCode
          : null;
    const result = await bse.post<Record<string, unknown>>('/sxp_list', {
      start: 0,
      length: 200,
      fields: ['ALL'],
      count_only: false,
    });
    const rows = ((result.lists ?? result.list ?? []) as Record<string, unknown>[]) || [];
    res.json(
      rows
        .filter((r) => !clientCode || String((r.investor as Record<string, unknown>)?.ucc ?? r.ucc ?? '') === clientCode)
        .map((r) => ({
          sxpRegNum: String(r.sxp_reg_num ?? r.id ?? ''),
          clientCode: String((r.investor as Record<string, unknown>)?.ucc ?? r.ucc ?? ''),
          type: String(r.sxp_type ?? ''),
          schemeCode: String(r.src_scheme ?? ''),
          amount: Number(r.amount ?? 0),
          frequency: String(r.freq ?? ''),
          startDate: String(r.start_date ?? ''),
          status: String(r.status ?? ''),
          isMock: false,
        })),
    );
  } catch (err) {
    next(err);
  }
});

/** Cancel a systematic plan. */
app.post('/sxp/cancel', async (req, res, next) => {
  try {
    const { sxpRegNum } = req.body as { sxpRegNum: string };
    // A registration number alone proves nothing — confirm it is the caller's.
    if (req.caller?.kind === 'client') {
      const list = await bse.post<Record<string, unknown>>('/sxp_list', {
        start: 0, length: 500, fields: ['ALL'], count_only: false,
      });
      const rows = ((list.lists ?? list.list ?? []) as Record<string, unknown>[]) || [];
      const hit = rows.find(
        (r) => String(r.sxp_id ?? r.sxp_reg_num ?? '') === String(sxpRegNum),
      );
      await assertOwnsByUcc(req, ((hit?.investor as Record<string, unknown>)?.ucc ?? hit?.ucc) as string, 'plan');
    }
    const result = await bse.post<Record<string, unknown>>('/sxp_cancel', {
      sxp_reg_num: sxpRegNum,
      member: cfg.bseMemberCode,
    });
    res.json({ sxpRegNum, status: 'CANCEL_REQUESTED', raw: result, isMock: false });
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
