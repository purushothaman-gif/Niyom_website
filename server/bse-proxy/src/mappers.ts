/**
 * Mappers — NIYOM app view-models ⇄ BSE v2 payloads.
 * -----------------------------------------------------------------------------
 * The app posts the SAME JSON shapes its BseGateway uses (see
 * src/portal/services/bse/contract.ts + types/funds.ts in the web repo). This
 * module re-declares those wire shapes (proxy is a separate package) and maps
 * them onto BSE v2 request bodies per docs/bse-starmf-v2-api.md.
 *
 * Fields marked UAT-VERIFY must be confirmed against the sandbox before prod.
 */

/* ----------------------------- incoming (app) ----------------------------- */

export interface AppOrderRequest {
  schemeCode: string;
  clientId: string; // NIYOM internal id — clientCode below is what BSE needs
  clientCode?: string; // BSE UCC (mandatory for live orders)
  type: 'lumpsum' | 'sip';
  plan: string;
  amount: number;
  folioNumber?: string;
  sipDay?: number;
  sipFrequency?: 'Monthly' | 'Quarterly';
  installments?: number;
}

export interface AppRedemptionRequest {
  clientId: string;
  clientCode?: string;
  schemeCode?: string;
  schemeName: string;
  folioNumber?: string;
  mode: 'amount' | 'units' | 'all';
  amount: number;
  units: number;
}

export interface AppSwitchRequest {
  clientId: string;
  clientCode?: string;
  fromSchemeCode?: string;
  fromSchemeName: string;
  toSchemeCode: string;
  toSchemeName: string;
  folioNumber?: string;
  mode: 'amount' | 'units' | 'all';
  amount: number;
  units: number;
}

/* ------------------------------ helpers ----------------------------------- */

/** Member order ref: numbers and hyphens only, 1-32 chars (BSE constraint). */
export function memRefId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 9999)}`.slice(0, 32);
}

const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);

/** SIP day+frequency → BSE start_date (YYYY-MM-DD) and freq code. */
function sipSchedule(req: AppOrderRequest): { start_date: string; freq: 'm' | 'q' } {
  const day = Math.min(Math.max(req.sipDay ?? 5, 1), 28);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), day);
  if (start <= now) start.setMonth(start.getMonth() + 1);
  return {
    start_date: isoDate(start),
    freq: req.sipFrequency === 'Quarterly' ? 'q' : 'm',
  };
}

/* ------------------------------ to BSE ------------------------------------ */

/** Lumpsum purchase → POST /v2/order_new. */
export function toOrderNew(req: AppOrderRequest, memberCode: string) {
  return {
    member: { code: memberCode }, // UAT-VERIFY: member object shape
    investor: { client_code: req.clientCode ?? req.clientId }, // UAT-VERIFY key name
    mem_ord_ref_id: memRefId(),
    type: 'p' as const,
    scheme: req.schemeCode,
    amount: req.amount,
    cur: 'INR',
    is_fresh: !req.folioNumber,
    ...(req.folioNumber ? { folio_no: req.folioNumber } : {}), // UAT-VERIFY key
  };
}

/** Redemption → POST /v2/order_new (type 'r'). */
export function toRedemption(req: AppRedemptionRequest, memberCode: string) {
  return {
    member: { code: memberCode },
    investor: { client_code: req.clientCode ?? req.clientId },
    mem_ord_ref_id: memRefId(),
    type: 'r' as const,
    scheme: req.schemeCode ?? '',
    cur: 'INR',
    is_fresh: false,
    ...(req.folioNumber ? { folio_no: req.folioNumber } : {}),
    ...(req.mode === 'units'
      ? { units: req.units }
      : req.mode === 'all'
        ? { all_units: true } // UAT-VERIFY: full-redemption flag name
        : { amount: req.amount }),
  };
}

/** Switch → POST /v2/order_new (type 's'; same-AMC only per BSE docs). */
export function toSwitch(req: AppSwitchRequest, memberCode: string) {
  return {
    member: { code: memberCode },
    investor: { client_code: req.clientCode ?? req.clientId },
    mem_ord_ref_id: memRefId(),
    type: 's' as const,
    scheme: req.fromSchemeCode ?? '',
    dest_scheme: req.toSchemeCode, // UAT-VERIFY key name for switch target
    cur: 'INR',
    is_fresh: false,
    ...(req.folioNumber ? { folio_no: req.folioNumber } : {}),
    ...(req.mode === 'all' ? { all_units: true } : { amount: req.amount }),
  };
}

/** SIP → POST /v2/sxp_register (documented checklist). */
export function toSxpRegister(req: AppOrderRequest, memberCode: string) {
  const { start_date, freq } = sipSchedule(req);
  return {
    sxp_type: 'SIP' as const,
    mem_sxp_ref_id: memRefId(),
    investor: { client_code: req.clientCode ?? req.clientId },
    member: memberCode,
    src_scheme: req.schemeCode,
    amount: req.amount,
    cur: 'INR',
    start_date,
    freq,
    phys_or_demat: 'p' as const,
    is_fresh: !req.folioNumber,
    is_nomination_opted: false, // UAT-VERIFY: nomination handling policy
    ...(req.installments ? { num_inst: req.installments } : {}),
    // exch_mandate_id: mandatory for XSIP — wire once mandates are registered.
  };
}

/* ------------------------------ from BSE ---------------------------------- */

/** Expected NAV date: same-day before 3pm IST cut-off, else next day. */
function expectedNavDate(): string {
  const d = new Date();
  if (d.getHours() >= 15) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

/**
 * Shape the app's OrderResult/TxnResult from a BSE order_new / sxp_register
 * response. BSE ids: UAT-VERIFY exact field (id / order_id / sxp_reg_num).
 */
export function toAppOrderResult(
  bse: Record<string, unknown>,
  req: AppOrderRequest,
  schemeName: string,
) {
  const orderId = String(bse.id ?? bse.order_id ?? bse.sxp_reg_num ?? '');
  return {
    orderId,
    schemeCode: req.schemeCode,
    schemeName,
    type: req.type,
    amount: req.amount,
    status: 'confirmed' as const,
    placedAt: new Date().toISOString(),
    expectedNavDate: expectedNavDate(),
    isMock: false,
    // NOTE: BSE v2 requires investor 2FA per transaction. The 2FA link (via
    // /v2/get_2fa_link) should be surfaced to the client — app-side type
    // extension planned; until then the link can be delivered out-of-band.
  };
}

export function toAppTxnResult(
  bse: Record<string, unknown>,
  kind: 'redeem' | 'switch',
  schemeName: string,
  detail: string,
  amount: number,
) {
  return {
    orderId: String(bse.id ?? bse.order_id ?? ''),
    kind,
    schemeName,
    detail,
    amount,
    status: 'confirmed' as const,
    placedAt: new Date().toISOString(),
    expectedNavDate: expectedNavDate(),
    isMock: false,
  };
}

/**
 * Scheme master row -> app FundScheme. Field names verified against the BSE
 * StARMF 2.0 demo `/api/master_scheme_list` response (25-Jul-2026). The scheme
 * master carries identity + AMC + plan/option; NAV, returns, AUM, expense and
 * risk are NOT in this feed (NAV comes from nav_master_list) — enrich later.
 */
export function toAppScheme(row: Record<string, unknown>) {
  const s = (keys: string[], fb = ''): string => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && String(v).trim() !== '') return String(v);
    }
    return fb;
  };
  const num = (keys: string[], fb = 0): number => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && v !== '' && !isNaN(Number(v))) return Number(v);
    }
    return fb;
  };

  const catText = (s(['scheme_category']) + ' ' + s(['scheme_sub_category'])).toLowerCase();
  const category = /equity|elss|large|mid|small|flexi|multi.?cap|index|sectoral|thematic|contra|value|focused/.test(catText)
    ? 'Equity'
    : /debt|bond|gilt|liquid|money.?market|duration|credit|overnight|banking.?psu|corporate|floater/.test(catText)
      ? 'Debt'
      : /hybrid|balanced|arbitrage|multi.?asset|equity.?savings|advantage/.test(catText)
        ? 'Hybrid'
        : 'Other';

  const optText = (s(['scheme_option']) + ' ' + s(['name'])).toLowerCase();
  const plans = /idcw|dividend|payout|reinvest/.test(optText) && !/growth/.test(optText) ? ['IDCW'] : ['Growth'];

  const exitRemarks = s(['scheme_exit_load_remarks']);
  const exitNum = num(['scheme_exit_load']);
  const exitLoad = exitRemarks && exitRemarks !== '0' ? exitRemarks : exitNum ? String(exitNum) : 'Nil';

  return {
    schemeCode: s(['scheme_bse_code', 'scheme_rta_code', 'scheme_cpc_code']),
    name: s(['name', 'parent_scheme_name']),
    amc: s(['scheme_amc_name'], '—'),
    category,
    subCategory: s(['scheme_sub_category']),
    riskLevel: 'Moderate', // not in scheme master feed
    nav: 0, // from nav_master_list (separate feed) — enrich later
    navDate: '',
    returns: { '1M': 0, '6M': 0, '1Y': 0, '3Y': 0, '5Y': 0 },
    expenseRatio: 0,
    aum: 0,
    minLumpsum: 0, // nested in `lumpsum` array — enrich later
    minSip: 0, // nested in `systematic` array — enrich later
    exitLoad,
    fundManager: '—',
    benchmark: s(['scheme_benchmark'], '—'),
    rating: 0,
    plans,
    isin: s(['scheme_isin']),
    isMock: false,
  };
}
