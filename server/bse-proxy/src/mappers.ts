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

/**
 * Member order reference: digits and hyphens only, 1-32 chars (BSE constraint),
 * and it must be UNIQUE — BSE rejects or misattributes duplicates.
 *
 * The previous `Date.now()-random(0..9998)` collided about 0.45% of the time
 * for ten orders placed in the same millisecond: invisible in single-user
 * testing, inevitable once clients transact concurrently, and it lands on
 * money. A per-process counter cannot collide within a process; the random
 * salt (fixed at startup) separates processes and restarts that share a
 * millisecond.
 */
const REF_SALT = String(Math.floor(Math.random() * 9000) + 1000);
let refCounter = 0;

export function memRefId(): string {
  refCounter = (refCounter + 1) % 1_000_000;
  return `${Date.now()}-${REF_SALT}-${refCounter}`;
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

/**
 * The EUIN to declare on a transaction — the individual who executed it,
 * resolved from the signed-in employee and never from the client record.
 *
 * There is deliberately no ARN here. BSE derives `broker_code` from the member
 * record itself (demo returns `ARN-657458` for member 66899 without us sending
 * anything), and `sub_br_arn` means a SUB-broker's ARN — putting our own ARN
 * there would declare NIYOM as its own sub-broker.
 */
export interface AppMemDetails {
  euin: string;
}

/**
 * mem_details (§7.3.34). Optional at BSE — nothing rejects without it — but
 * SEBI expects an EUIN declaration on distributor-executed transactions.
 *
 * VERIFIED LIVE against demo (order 5001203566): `euin_flag` is a **boolean**,
 * despite the spec describing it as "(Y | N)" — sending the string 'Y' fails
 * the whole payload with errcode `invalid_json`. true means an EUIN is being
 * declared; false is the execution-only case where the investor confirms no
 * advice was given. We always declare one, so it is never false.
 */
function toMemDetails(mem: AppMemDetails) {
  return { euin_flag: true, euin: mem.euin };
}

/** Lumpsum purchase → POST /v2/order_new. */
export function toOrderNew(req: AppOrderRequest, memberCode: string, mem: AppMemDetails) {
  return {
    mem_details: toMemDetails(mem),
    // VERIFIED LIVE: order_new takes `member` as a STRING (add_ucc takes an
    // object) and the investor key is `ucc` (add_ucc uses client_code).
    member: memberCode,
    investor: { ucc: req.clientCode ?? req.clientId },
    mem_ord_ref_id: memRefId(),
    type: 'p' as const,
    phys_or_demat: 'p' as const, // physical (non-demat) — required by order_new
    scheme: req.schemeCode,
    amount: req.amount,
    cur: 'INR',
    is_fresh: !req.folioNumber,
    ...(req.folioNumber ? { folio: req.folioNumber } : {}), // UAT-VERIFY key
  };
}

/** Redemption → POST /v2/order_new (type 'r'). */
export function toRedemption(req: AppRedemptionRequest, memberCode: string, mem: AppMemDetails) {
  return {
    mem_details: toMemDetails(mem),
    member: memberCode,
    investor: { ucc: req.clientCode ?? req.clientId },
    mem_ord_ref_id: memRefId(),
    type: 'r' as const,
    phys_or_demat: 'p' as const, // physical (non-demat) — required by order_new
    scheme: req.schemeCode ?? '',
    cur: 'INR',
    is_fresh: false,
    ...(req.folioNumber ? { folio: req.folioNumber } : {}),
    ...(req.mode === 'units'
      ? { units: req.units }
      : req.mode === 'all'
        ? { all_units: true } // UAT-VERIFY: full-redemption flag name
        : { amount: req.amount }),
  };
}

/** Switch → POST /v2/order_new (type 's'; same-AMC only per BSE docs). */
export function toSwitch(req: AppSwitchRequest, memberCode: string, mem: AppMemDetails) {
  return {
    mem_details: toMemDetails(mem),
    member: memberCode,
    investor: { ucc: req.clientCode ?? req.clientId },
    mem_ord_ref_id: memRefId(),
    type: 's' as const,
    phys_or_demat: 'p' as const, // physical (non-demat) — required by order_new
    scheme: req.fromSchemeCode ?? '',
    dest_scheme: req.toSchemeCode, // UAT-VERIFY key name for switch target
    cur: 'INR',
    is_fresh: false,
    ...(req.folioNumber ? { folio: req.folioNumber } : {}),
    ...(req.mode === 'all' ? { all_units: true } : { amount: req.amount }),
  };
}

/** SIP → POST /v2/sxp_register (documented checklist). */
export function toSxpRegister(req: AppOrderRequest, memberCode: string, mem: AppMemDetails) {
  const { start_date, freq } = sipSchedule(req);
  return {
    mem_details: toMemDetails(mem),
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
  // VERIFIED LIVE: order_new answers { items: [ { mem_ord_ref_id, id } ] }.
  const items = (bse.items as Record<string, unknown>[] | undefined) ?? [];
  const orderId = String(items[0]?.id ?? bse.id ?? bse.order_id ?? bse.sxp_id ?? bse.sxp_reg_num ?? '');
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
    // Same envelope as order_new: the id lives in data.items[], NOT data.id.
    // Reading only bse.id produced an empty orderId on every redemption/switch.
    orderId: String(
      ((bse.items as Record<string, unknown>[] | undefined) ?? [])[0]?.id ??
        bse.id ??
        bse.order_id ??
        '',
    ),
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
/**
 * Trading rules a scheme imposes, dug out of the nested `lumpsum` array.
 * The console needs these BEFORE staff can place an order: BSE rejects a
 * physical UCC on a demat-only scheme (this is exactly what made 007-DP fail),
 * and each transaction type carries its own min/max and cut-off time.
 */
function schemeModes(row: Record<string, unknown>): { physical: boolean; demat: boolean } {
  const modes = (row.scheme_transaction_mode_allowed as Record<string, unknown>[]) ?? [];
  const vals = modes
    .map((m) => String(m?.scheme_transaction_mode_demat_physical_allowed ?? '').toLowerCase())
    .join(' ');
  return { physical: vals.includes('physical'), demat: vals.includes('demat') };
}

export interface SchemeTxnRule {
  min: number;
  max: number;
  minAdditional: number;
  cutoffTime: string;
}

/** Limits for one transaction type: Purchase / Redemption / Switch-IN / Switch-OUT. */
function schemeTxnRule(row: Record<string, unknown>, type: string): SchemeTxnRule | null {
  const entries = (row.lumpsum as Record<string, unknown>[]) ?? [];
  const hit = entries.find(
    (e) => String(e?.scheme_transaction_type ?? '').toLowerCase() === type.toLowerCase(),
  );
  if (!hit) return null;
  const amt =
    ((hit.scheme_transaction_single_details as Record<string, unknown>)
      ?.scheme_transaction_amt as Record<string, unknown>) ?? {};
  return {
    min: Number(amt.scheme_transaction_min_amt ?? 0),
    max: Number(amt.scheme_transaction_max_amt ?? 0),
    minAdditional: Number(amt.scheme_transaction_min_adtnl_amt ?? 0),
    cutoffTime: String(hit.scheme_transaction_cutoff_time ?? ''),
  };
}

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
    minLumpsum: schemeTxnRule(row, 'Purchase')?.min ?? 0,
    minSip: 0, // nested in `systematic` array — enrich later
    exitLoad,
    fundManager: '—',
    benchmark: s(['scheme_benchmark'], '—'),
    rating: 0,
    plans,
    isin: s(['scheme_isin']),
    // Trading rules — the console gates its order form on these.
    allowsPhysical: schemeModes(row).physical,
    allowsDemat: schemeModes(row).demat,
    isOpen: s(['scheme_offer_status']).toUpperCase() === 'OPEN',
    purchase: schemeTxnRule(row, 'Purchase'),
    redemption: schemeTxnRule(row, 'Redemption'),
    isMock: false,
  };
}

/* ============================== UCC (client onboarding) ==================== */

/**
 * A supporting document. BSE carries these on identifier blocks as base64, and
 * caps each at 10240 KB (§7.4.20). `docNumber` is the identifier_number BSE
 * requires alongside the blob — the account number for a cancelled cheque, the
 * client code for an AOF.
 */
export interface AppUccDocument {
  docNumber: string;
  fileName: string;
  fileSize: number;              // bytes
  fileBlob: string;              // base64, no data: prefix
}

/**
 * One nominee. BSE takes nominees under the FIRST holder only, at most 3, and
 * the percentages must total exactly 100 (§6.2.2.2.4).
 *
 * `relation` is a nomination_relation code, not a label — 3 = Daughter,
 * 5 = Father, 11 = Husband, 18 = Son, 21 = Wife (§7.4.18).
 */
export interface AppNominee {
  firstName: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  relation: string;
  percent: number;
  identifierType: 'pan' | 'aadhaar' | 'passport';
  identifierNumber: string;
  isMinor?: boolean;
  guardian?: { firstName: string; middleName?: string; lastName?: string; dob: string; pan: string };
}

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
  fatca?: { placeOfBirth?: string; countryOfBirth?: string; fatherName?: string; spouseName?: string; incomeSlab?: string; wealthSource?: string; politicallyExposed?: boolean };
  /** Empty or absent means the client has declined to nominate. */
  nominees?: AppNominee[];
  documents?: {
    bankProof?: AppUccDocument;
    bankProofType?: 'cancel_cheque' | 'bank_statement';
    aof?: AppUccDocument;
  };
}

/** Identifier block carrying a document, in the shape BSE expects (§7.3.15). */
function toDocIdentifier(identifierType: string, doc: AppUccDocument) {
  return {
    identifier_type: identifierType,
    identifier_number: doc.docNumber,
    file_name: doc.fileName,
    file_size: doc.fileSize,
    file_blob: doc.fileBlob,
  };
}

/**
 * One nominee -> BSE's nomination block (§7.3.10). BSE requires comm_addr and
 * contact on every nominee; the form doesn't ask for them because BSE's own
 * worked example reuses the holder's, so they are passed in from the holder.
 */
function toNomination(
  n: AppNominee,
  holderAddr: Record<string, unknown>,
  holderContact: Record<string, unknown>,
) {
  return {
    person: {
      first_name: n.firstName,
      middle_name: n.middleName ?? '',
      last_name: n.lastName ?? '',
      ...(n.dob ? { dob: n.dob } : {}),
    },
    comm_addr: holderAddr,
    contact: holderContact,
    nomination_percent: n.percent,
    nomination_relation: n.relation,
    // BSE: this field must always be false for a nominee.
    is_pan_exempt: false,
    pan_exempt_category: '',
    ...(n.isMinor ? { is_minor: true } : {}),
    identifier: [
      { identifier_type: n.identifierType, identifier_number: n.identifierNumber },
    ],
    ...(n.isMinor && n.guardian
      ? {
          guardian: {
            first_name: n.guardian.firstName,
            middle_name: n.guardian.middleName ?? '',
            last_name: n.guardian.lastName ?? '',
            dob: n.guardian.dob,
            is_pan_exempt: false,
            pan_exempt_category: '',
            identifier: [
              { identifier_type: 'pan', identifier_number: n.guardian.pan.toUpperCase() },
            ],
          },
        }
      : {}),
  };
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
  const pan = req.pan.toUpperCase();
  const nominees = req.nominees ?? [];
  const docs = req.documents ?? {};

  const commAddr = {
    address_line_1: req.address.line1,
    address_line_2: req.address.line2 ?? '',
    address_line_3: req.address.line3 ?? '',
    postalcode: req.address.pincode,
    city: req.address.city,
    state: req.address.state,
    country: req.address.country ?? 'IND',
  };
  const contact = {
    contact_number: req.mobile,
    country_code: '91',
    whose_contact_number: 'SE',
    email_address: req.email,
    whose_email_address: 'SE',
    contact_type: 'PR',
  };

  return {
    member: { member_id: memberCode },
    investor: { client_code: req.clientCode },
    holding_nature: req.holdingNature ?? 'SI',
    tax_code: req.taxCode ?? '01',
    rdmp_idcw_pay_mode: '01',
    is_client_physical: true,
    is_client_demat: false,
    // No nominees means the client has declined to nominate — a deliberate
    // opt-out, which is what SEBI requires be recorded either way.
    is_nomination_opted: nominees.length > 0,
    nomination_auth_mode: 'O',
    ...(nominees.length > 0 ? { nominee_soa: true } : {}),
    comm_mode: 'E',
    onboarding: 'Z',
    holder: [
      {
        holder_rank: '1',
        occ_code: occ,
        auth_mode: 'M',
        is_pan_exempt: false,
        pan_exempt_category: '',
        identifier: [{ identifier_type: 'pan', identifier_number: pan }],
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
        contact: [contact],
        // Nominees hang off the first holder only (§7.3.4).
        ...(nominees.length > 0
          ? { nomination: nominees.map((n) => toNomination(n, commAddr, contact)) }
          : {}),
      },
    ],
    comm_addr: commAddr,
    bank_account: [
      {
        ifsc_code: req.bank.ifsc.toUpperCase(),
        bank_acc_num: req.bank.accountNumber,
        bank_acc_type: req.bank.accountType ?? 'SB',
        account_owner: 'SELF',
        // A cancelled cheque is what lets BSE's bank verification actually
        // pass — without it the check sits at "Verification failed" forever.
        identifier: docs.bankProof
          ? [toDocIdentifier(docs.bankProofType ?? 'cancel_cheque', docs.bankProof)]
          : [],
      },
    ],
    fatca: [
      {
        // BSE's own worked example capitalises this key; their field table says
        // holder_rank. The example is what the API actually accepts.
        HolderRank: '1',
        client_name: fullName,
        place_of_birth: fatca.placeOfBirth ?? req.address.city,
        country_of_birth: fatca.countryOfBirth ?? 'IND',
        investor_type: 'Individual',
        dob: req.dob,
        // Both are conditional with a 2-character minimum, so send them only
        // when we have them rather than passing an empty string.
        ...(fatca.fatherName ? { father_name: fatca.fatherName } : {}),
        ...(fatca.spouseName ? { spouse_name: fatca.spouseName } : {}),
        address_type: '1',
        occ_code: occ,
        occ_type: 'B',
        tax_status: 'Individual',
        data_source: 'P',
        wealth_source: fatca.wealthSource ?? '1',
        income_slab: fatca.incomeSlab ?? '31',
        politically_exposed: fatca.politicallyExposed ? 'Y' : 'N',
        is_self_declared: true,
        identifier: { identifier_type: 'pan', identifier_number: pan },
        // Mandatory per §7.3.16 and present in BSE's worked example. For a
        // resident individual the tax id is the PAN — tax_id_type 'C' is
        // "PAN Card" in fatca_identifier_type (§7.4.35), NOT 'A' (Passport).
        tax_residency: [{ country: 'IND', tax_id_no: pan, tax_id_type: 'C' }],
      },
    ],
    ...(docs.aof ? { aof: { is_aof_submitted: true } } : {}),
    identifiers: docs.aof ? [toDocIdentifier('aof', docs.aof)] : [],
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

/* ============================== SXP (SIP / SWP / STP) ====================== */

export type AppSxpType = 'SIP' | 'SWP' | 'STP' | 'TOPUP' | 'SPROD';
/** m=monthly w=weekly d=daily f=fortnightly q=quarterly h=half-yearly y=yearly */
export type AppSxpFreq = 'm' | 'w' | 'd' | 'f' | 'q' | 'h' | 'y';

export interface AppSxpRequest {
  clientCode: string;              // BSE UCC
  schemeCode: string;              // source BSE scheme code
  destSchemeCode?: string;         // STP only — must be same AMC
  amount: number;
  type?: AppSxpType;               // default SIP
  frequency?: AppSxpFreq;          // default 'm'
  startDate: string;               // YYYY-MM-DD
  installments?: number;           // or endDate
  endDate?: string;                // mandatory when frequency = 'd'
  txnDate?: number;                // day of month (or 1-5 weekday when freq='w')
  folioNumber?: string;
  mandateId?: string | number;     // exch_mandate_id — REQUIRED for XSIP
  isUnits?: boolean;               // SWP/STP in units rather than rupees
}

/**
 * App view-model -> BSE `/sxp_register`. Endpoint is NOT under /v2 (that 404s).
 *
 * `mem_sxp_ref_id` accepts ONLY digits and hyphens (letters are rejected with
 * errcode `invalid`) — memRefId() already satisfies that, do not prefix it.
 */
export function toSxpRegister2(req: AppSxpRequest, memberCode: string, mem: AppMemDetails) {
  const freq = req.frequency ?? 'm';
  return {
    mem_details: toMemDetails(mem),
    sxp_type: req.type ?? 'SIP',
    mem_sxp_ref_id: memRefId(),
    investor: { ucc: req.clientCode },
    member: memberCode,
    src_scheme: req.schemeCode,
    ...(req.destSchemeCode ? { dest_scheme: req.destSchemeCode } : {}),
    amount: req.amount,
    cur: 'INR',
    ...(req.isUnits ? { isunits: true } : {}),
    is_fresh: !req.folioNumber,
    ...(req.folioNumber ? { src_folio: req.folioNumber } : {}),
    phys_or_demat: 'p' as const,
    start_date: req.startDate,
    freq,
    // freq 'd' (daily) needs end_date and ignores txn_date; everything else
    // takes ninstallments + txn_date.
    ...(freq === 'd'
      ? { end_date: req.endDate ?? req.startDate }
      : {
          ...(req.installments ? { ninstallments: req.installments } : {}),
          ...(req.endDate ? { end_date: req.endDate } : {}),
          txn_date: req.txnDate ?? Number(req.startDate.slice(8, 10)),
        }),
    ...(req.mandateId ? { exch_mandate_id: Number(req.mandateId) } : {}),
    is_nomination_opted: false,
  };
}

export function toAppSxpResult(bse: Record<string, unknown>, req: AppSxpRequest) {
  return {
    // VERIFIED LIVE: the field is `sxp_id` (docs say sxp_reg_num).
    sxpRegNum: String(bse.sxp_id ?? bse.sxp_reg_num ?? bse.id ?? ''),
    type: req.type ?? 'SIP',
    schemeCode: req.schemeCode,
    amount: req.amount,
    frequency: req.frequency ?? 'm',
    startDate: req.startDate,
    status: 'REGISTERED' as const,
    isMock: false,
  };
}
