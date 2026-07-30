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
    if (body.type === 'sip') {
      const sxp = await bse.post<Record<string, unknown>>(
        '/sxp_register',
        toSxpRegister(body, cfg.bseMemberCode),
      );
      const regNum = String(sxp.sxp_id ?? sxp.sxp_reg_num ?? sxp.id ?? '');
      if (!regNum) {
        throw new BseError('BSE accepted the SIP but returned no registration number', 502, sxp);
      }
      return res.json(toAppOrderResult({ ...sxp, id: regNum }, body, body.schemeName ?? body.schemeCode));
    }
    // NOTE: /order_new — NOT /v2/order_new, which 404s on the live platform.
    // VERIFIED LIVE: order_new wraps orders in an ARRAY under `orders`. Sending
    // a bare order object returns {"status":"success","data":{}} and silently
    // places NOTHING — which is the trap the guard below exists for.
    const result = await bse.post<Record<string, unknown>>('/order_new', {
      orders: [toOrderNew(body, cfg.bseMemberCode)],
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
    res.json(toAppOrderResult(result, body, body.schemeName ?? body.schemeCode));
  } catch (err) {
    next(err);
  }
});

app.post('/redemption', async (req, res, next) => {
  try {
    const body = req.body as AppRedemptionRequest;
    const result = await bse.post<Record<string, unknown>>('/order_new', { orders: [toRedemption(body, cfg.bseMemberCode)] });
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
    const result = await bse.post<Record<string, unknown>>('/order_new', { orders: [toSwitch(body, cfg.bseMemberCode)] });
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
    const { orderId, clientCode } = req.body as { orderId: string; clientCode: string };
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

/* ------------------------------- Mandates --------------------------------- */

/**
 * Register a mandate (auto-debit authority) — required before SIPs can run.
 * Verified live 30-Jul-2026 for both E-NACH and UPI.
 */
app.post('/mandate', async (req, res, next) => {
  try {
    const body = req.body as AppMandateRequest;
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
    res.json({ ...toAppMandateResult(result), raw: result });
  } catch (err) {
    next(err);
  }
});

/** All mandates, newest first — optionally filtered to one client. */
app.get('/mandates', async (req, res, next) => {
  try {
    const clientCode = typeof req.query.clientCode === 'string' ? req.query.clientCode : null;
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

/* ------------------------- Read models for the console --------------------- */

/**
 * Order book. BSE splits orders into open ("o") and closed ("c") lists and
 * requires `open_close` INSIDE filter_param — so we fetch both and merge.
 */
app.get('/orders', async (req, res, next) => {
  try {
    const clientCode = typeof req.query.clientCode === 'string' ? req.query.clientCode : null;
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
app.get('/uccs', async (_req, res, next) => {
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
          isMock: false,
        };
      }),
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
    const result = await bse.post<Record<string, unknown>>(
      '/sxp_register',
      toSxpRegister2(body, cfg.bseMemberCode),
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
    const clientCode = typeof req.query.clientCode === 'string' ? req.query.clientCode : null;
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
