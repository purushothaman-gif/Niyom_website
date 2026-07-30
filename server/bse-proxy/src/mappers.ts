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

/* ============================== UCC (client onboarding) ==================== */

/** App-side UCC registration request (what the portal/CRM posts to the proxy). */
export interface AppUccRequest {
  clientCode: string;            // our UCC id for this client (<=20 chars)
  pan: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  dob: string;                   // YYYY-MM-DD
  gender: 'M' | 'F' | 'O';
  email: string;
  mobile: string;
  occupationCode?: string;       // occ_code, default '02' (service)
  taxCode?: string;              // default '01' (resident individual)
  holdingNature?: string;        // default 'SI' (single)
  kycType?: string;              // default 'C' (CKYC)
  ckycNumber?: string;
  address: { line1: string; line2?: string; line3?: string; city: string; state: string; pincode: string; country?: string };
  bank: { accountNumber: string; ifsc: string; accountType?: string };
  fatca?: { placeOfBirth?: string; countryOfBirth?: string; fatherName?: string; incomeSlab?: string; wealthSource?: string; politicallyExposed?: boolean };
}

/**
 * App view-model -> BSE `/v2/add_ucc` payload. Shapes verified live against the
 * StARMF 2.0 demo (30-Jul-2026): a physical (non-demat) resident individual UCC
 * registered successfully with this exact structure.
 *
 * NOTE BSE validates the PAN's 4th char by entity type — 'P' for an individual
 * person. A malformed PAN fails with errcode invalid_data on holder.identifier.
 */
export function toAddUcc(req: AppUccRequest, memberCode: string) {
  const fatca = req.fatca ?? {};
  const fullName = [req.firstName, req.middleName, req.lastName].filter(Boolean).join(' ');
  const occ = req.occupationCode ?? '02';
  return {
    member: { member_id: memberCode },
    investor: { client_code: req.clientCode },
    holding_nature: req.holdingNature ?? 'SI',
    tax_code: req.taxCode ?? '01',
    rdmp_idcw_pay_mode: '01',
    is_client_physical: true,
    is_client_demat: false,
    is_nomination_opted: false,
    nomination_auth_mode: 'O',
    comm_mode: 'E',
    onboarding: 'Z',
    holder: [
      {
        holder_rank: '1',
        occ_code: occ,
        auth_mode: 'M',
        is_pan_exempt: false,
        pan_exempt_category: '',
        identifier: [{ identifier_type: 'pan', identifier_number: req.pan.toUpperCase() }],
        // BSE rejects kyc_type 'C' (CKYC) unless a ckyc_number is supplied, so
        // default to 'K' (KRA) when we don't have one. Verified live.
        kyc_type: req.kycType ?? (req.ckycNumber ? 'C' : 'K'),
        ckyc_number: req.ckycNumber ?? '',
        person: {
          first_name: req.firstName,
          middle_name: req.middleName ?? '',
          last_name: req.lastName ?? '',
          dob: req.dob,
          gender: req.gender,
        },
        contact: [
          {
            contact_number: req.mobile,
            country_code: '91',
            whose_contact_number: 'SE',
            email_address: req.email,
            whose_email_address: 'SE',
            contact_type: 'PR',
          },
        ],
      },
    ],
    comm_addr: {
      address_line_1: req.address.line1,
      address_line_2: req.address.line2 ?? '',
      address_line_3: req.address.line3 ?? '',
      postalcode: req.address.pincode,
      city: req.address.city,
      state: req.address.state,
      country: req.address.country ?? 'IND',
    },
    bank_account: [
      {
        ifsc_code: req.bank.ifsc.toUpperCase(),
        bank_acc_num: req.bank.accountNumber,
        bank_acc_type: req.bank.accountType ?? 'SB',
        account_owner: 'SELF',
        identifier: [],
      },
    ],
    fatca: [
      {
        HolderRank: '1',
        client_name: fullName,
        place_of_birth: fatca.placeOfBirth ?? req.address.city,
        country_of_birth: fatca.countryOfBirth ?? 'IND',
        investor_type: 'Individual',
        dob: req.dob,
        father_name: fatca.fatherName ?? '',
        address_type: '1',
        occ_code: occ,
        occ_type: 'B',
        tax_status: 'Individual',
        data_source: 'P',
        wealth_source: fatca.wealthSource ?? '1',
        income_slab: fatca.incomeSlab ?? '31',
        politically_exposed: fatca.politicallyExposed ? 'Y' : 'N',
        is_self_declared: true,
        identifier: { identifier_type: 'pan', identifier_number: req.pan.toUpperCase() },
      },
    ],
    identifiers: [],
  };
}

/** BSE add_ucc / get_ucc response -> the app's UccRegistrationResult shape. */
export function toAppUccResult(bse: Record<string, unknown>, fallbackCode: string) {
  return {
    clientCode: String(bse.client_code ?? bse.ucc ?? fallbackCode),
    status: String(bse.status ?? bse.ucc_status ?? 'PENDING_AUTH'),
    isMock: false,
  };
}

/* ============================== Mandates =================================== */

/** Mandate kinds BSE accepts. 'N' = E-NACH, 'U' = UPI AutoPay, 'X' = NACH. */
export type AppMandateType = 'ENACH' | 'UPI' | 'NACH';

export interface AppMandateRequest {
  clientCode: string;              // BSE UCC
  amount: number;                  // max debit amount
  type?: AppMandateType;           // default ENACH
  startDate?: string;              // YYYY-MM-DD, default today
  validTill?: string;              // YYYY-MM-DD, default +10y
  bank: { accountNumber: string; ifsc: string; accountType?: string; name?: string; branch?: string };
  vpa?: string;                    // UPI only (e.g. name@okicici)
  redirectUrl?: string;            // where BSE returns the investor after E-NACH
}

const BSE_MANDATE_TYPE: Record<AppMandateType, string> = { ENACH: 'N', UPI: 'U', NACH: 'X' };

function plusYears(iso: string, years: number): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * App view-model -> BSE `/mandate_register`. Verified live on the demo
 * (30-Jul-2026): both E-NACH and UPI mandates registered successfully.
 *
 * BSE pairs type and mode strictly, and rejects mismatches:
 *   E-NACH ('N') -> mode 'ACH', and `vpa` must NOT be sent ("not_allowed").
 *   UPI    ('U') -> mode 'DD',  and `vpa` is what the collect request goes to.
 * NOTE the endpoint is /mandate_register — NOT under /v2.
 */
export function toMandateRegister(req: AppMandateRequest, memberCode: string) {
  const kind = req.type ?? 'ENACH';
  const isUpi = kind === 'UPI';
  const start = req.startDate ?? isoDate();
  const bank: Record<string, unknown> = {
    ifsc: req.bank.ifsc.toUpperCase(),
    no: req.bank.accountNumber,
    type: req.bank.accountType ?? 'SB',
    name: req.bank.name ?? '',
    branch: req.bank.branch ?? '',
  };
  // vpa is UPI-only — sending it on an E-NACH mandate is rejected outright.
  if (isUpi && req.vpa) bank.vpa = [req.vpa];

  return {
    investor: { ucc: req.clientCode },
    member: memberCode,
    investor_bank_details: bank,
    amount: req.amount,
    start_date: start,
    valid_till: req.validTill ?? plusYears(start, 10),
    reg_date: isoDate(),
    type: BSE_MANDATE_TYPE[kind],
    mode: isUpi ? 'DD' : 'ACH',
    frequency: 'AS AND WHEN PRESENTED',
    request_type: 'REGISTRATION',
    ...(req.redirectUrl ? { redirect_url: req.redirectUrl } : {}),
  };
}

/**
 * BSE mandate_register response -> app MandateRegistrationResult.
 * E-NACH returns `link` — the BSE-hosted page where the INVESTOR authorises the
 * mandate; UPI returns no link (the collect request goes to their UPI app).
 */
export function toAppMandateResult(bse: Record<string, unknown>) {
  return {
    mandateId: String(bse.exch_mandate_id ?? ''),
    status: 'PENDING' as const,
    authUrl: (bse.link as string) || undefined,
    isMock: false,
  };
}
