/**
 * Partner Portal — demo mode.
 *
 * A self-contained showcase of the partner portal for prospective DSAs. It is
 * deliberately FRONT-END ONLY:
 *
 *   - No auth user, no Supabase session, no rows in any table. Nothing here can
 *     appear in Manage Clients, Reports, Dashboard, Transactions, DSA Payout or
 *     MIS revenue, all of which read nw_clients / nw_transactions unfiltered.
 *   - Every name, PAN, amount and statement below is invented. No real client's
 *     name, city, portfolio value or payout is ever shown to a prospect.
 *   - Read-only: PartnerService short-circuits its two write paths (submitLead,
 *     getStatementUrl) so a prospect clicking around cannot create a lead or
 *     reach a real statement PDF.
 *
 * These credentials are meant to be handed out and will be shared onward, so
 * they must never unlock anything real. They don't: the login screen recognises
 * them locally and never calls partner-pan-login, so there is nothing to
 * brute-force and no account behind them.
 */
import type {
  PartnerIdentity,
  PartnerClientRow,
  PartnerHoldingRow,
  PartnerTransactionRow,
  PartnerPayoutSummary,
  PartnerDebitNote,
  PartnerReferral,
  PartnerLead,
} from '../types';

/** Shown on the login screen and handed to prospects. */
export const DEMO_PAN = 'NIYOM1234D';
export const DEMO_PASSWORD = 'NiyomDemo@2026';

/** Not a real nw_dsa.id — nothing resolves it server-side. */
export const DEMO_DSA_ID = 'demo-partner';

const KEY = 'nw_partner_demo';

export function startDemoSession() {
  try { sessionStorage.setItem(KEY, '1'); } catch {}
}
export function endDemoSession() {
  try { sessionStorage.removeItem(KEY); } catch {}
}
export function isDemoSession(): boolean {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Case/space-insensitive match on the published demo credentials. */
export function isDemoCredentials(pan: string, password: string): boolean {
  return pan.trim().toUpperCase() === DEMO_PAN && password === DEMO_PASSWORD;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const demoProfile: PartnerIdentity = {
  dsa_id: DEMO_DSA_ID,
  dsa_code: 'NWDSA-DEMO-01',
  full_name: 'SAMPLE WEALTH ASSOCIATES',
  email: 'partner.demo@niyomwealth.com',
  mobile: '90000 00000',
  pan_masked: 'XXXXX1234D',
  address: 'Demo address — shown only in the sample portal',
  bank_name: 'HDFC BANK',
  bank_account_masked: 'XXXXXX4321',
  bank_ifsc: 'HDFC0000123',
  status: 'active',
  photo_url: null,
  login_enabled: true,
  password_changed: true,
  partner_since: '2025-04-01',
  rm_name: 'Your Relationship Manager',
  rm_email: 'partners@niyomwealth.com',
  rm_mobile: '+91 89394 33113',
  rm_avatar_url: null,
};

export const demoClients: PartnerClientRow[] = [
  {
    client_id: 'demo-c1', client_code: 'NW-DEMO-0001', full_name: 'ANAND KRISHNAMURTHY',
    city: 'CHENNAI', mobile_masked: 'XXXXXX1042', onboarding_status: 'active',
    verification_status: 'verified', sourced_on: '2025-06-12',
    invested_amount: 1250000, current_value: 1418500, holdings_count: 3,
  },
  {
    client_id: 'demo-c2', client_code: 'NW-DEMO-0002', full_name: 'MEERA SUNDARAM',
    city: 'COIMBATORE', mobile_masked: 'XXXXXX7715', onboarding_status: 'active',
    verification_status: 'verified', sourced_on: '2025-09-03',
    invested_amount: 640000, current_value: 689200, holdings_count: 2,
  },
  {
    client_id: 'demo-c3', client_code: 'NW-DEMO-0003', full_name: 'RAJESH IYER (HUF)',
    city: 'MADURAI', mobile_masked: 'XXXXXX3388', onboarding_status: 'active',
    verification_status: 'verified', sourced_on: '2026-01-20',
    invested_amount: 2100000, current_value: 2037000, holdings_count: 2,
  },
  {
    client_id: 'demo-c4', client_code: 'NW-DEMO-0004', full_name: 'KAVITHA NATARAJAN',
    city: 'BENGALURU', mobile_masked: 'XXXXXX9061', onboarding_status: 'kyc_pending',
    verification_status: 'pending', sourced_on: '2026-07-09',
    invested_amount: 0, current_value: 0, holdings_count: 0,
  },
];

export const demoPortfolios: Record<string, PartnerHoldingRow[]> = {
  'demo-c1': [
    { holding_id: 'demo-h1', product_type: 'unlisted_share', product_name: 'National Stock Exchange Ltd',
      quantity: 300, avg_price: 2085, invested_amount: 625500, current_value: 735000, gain_loss: 109500 },
    { holding_id: 'demo-h2', product_type: 'secondary_bond', product_name: 'Utkarsh Small Finance Bank Ltd',
      quantity: 4, avg_price: 101250, invested_amount: 405000, current_value: 421000, gain_loss: 16000 },
    { holding_id: 'demo-h3', product_type: 'mutual_fund', product_name: 'Parag Parikh Flexi Cap — Growth',
      quantity: 4210.55, avg_price: 52.6, invested_amount: 219500, current_value: 262500, gain_loss: 43000 },
  ],
  'demo-c2': [
    { holding_id: 'demo-h4', product_type: 'unlisted_share', product_name: 'Tata Capital Ltd',
      quantity: 500, avg_price: 880, invested_amount: 440000, current_value: 476000, gain_loss: 36000 },
    { holding_id: 'demo-h5', product_type: 'mutual_fund', product_name: 'HDFC Balanced Advantage — Growth',
      quantity: 4132.0, avg_price: 48.4, invested_amount: 200000, current_value: 213200, gain_loss: 13200 },
  ],
  'demo-c3': [
    { holding_id: 'demo-h6', product_type: 'secondary_bond', product_name: 'ESAF Small Finance Bank Ltd',
      quantity: 12, avg_price: 100500, invested_amount: 1206000, current_value: 1188000, gain_loss: -18000 },
    { holding_id: 'demo-h7', product_type: 'unlisted_share', product_name: 'HDB Financial Services Ltd',
      quantity: 1200, avg_price: 745, invested_amount: 894000, current_value: 849000, gain_loss: -45000 },
  ],
  'demo-c4': [],
};

export const demoTransactions: Record<string, PartnerTransactionRow[]> = {
  'demo-c1': [
    { txn_id: 'demo-t1', txn_date: '2026-05-14', txn_type: 'buy', product_type: 'unlisted_share',
      product_name: 'National Stock Exchange Ltd', quantity: 300, amount: 625500, dsa_price: 2072, client_price: 2085 },
    { txn_id: 'demo-t2', txn_date: '2026-02-27', txn_type: 'buy', product_type: 'secondary_bond',
      product_name: 'Utkarsh Small Finance Bank Ltd', quantity: 4, amount: 405000, dsa_price: 100600, client_price: 101250 },
  ],
  'demo-c2': [
    { txn_id: 'demo-t3', txn_date: '2026-06-05', txn_type: 'buy', product_type: 'unlisted_share',
      product_name: 'Tata Capital Ltd', quantity: 500, amount: 440000, dsa_price: 872, client_price: 880 },
  ],
  'demo-c3': [
    { txn_id: 'demo-t4', txn_date: '2026-04-18', txn_type: 'buy', product_type: 'secondary_bond',
      product_name: 'ESAF Small Finance Bank Ltd', quantity: 12, amount: 1206000, dsa_price: 99900, client_price: 100500 },
    { txn_id: 'demo-t5', txn_date: '2026-03-02', txn_type: 'buy', product_type: 'unlisted_share',
      product_name: 'HDB Financial Services Ltd', quantity: 1200, amount: 894000, dsa_price: 738, client_price: 745 },
  ],
  'demo-c4': [],
};

/** Mirrors the real RPC: every figure comes from a raised statement, never an accrual. */
export const demoPayout: PartnerPayoutSummary = {
  fy_label: '2026-27',
  fy_gross: 46850,
  fy_tds: 937,
  fy_net: 45913,
  lifetime_gross: 118400,
  lifetime_tds: 2368,
  lifetime_net: 116032,
  paid_net: 36113,
  awaiting_signature_count: 1,
  awaiting_payment_net: 9800,
  latest_note_number: 'DN-2026-07-D004',
  latest_note_period: 'Jul 2026',
  latest_note_net: 9800,
};

export const demoNotes: PartnerDebitNote[] = [
  { id: 'demo-n4', debit_note_number: 'DN-2026-07-D004', month: 7, year: 2026,
    payout_amount: 10000, tds_amount: 200, net_payable_amount: 9800,
    status: 'generated', signature_status: 'sent',
    pdf_url: 'demo', signed_pdf_url: null, signed_at: null, paid_at: null,
    created_at: '2026-07-08T10:00:00Z' },
  { id: 'demo-n3', debit_note_number: 'DN-2026-06-D003', month: 6, year: 2026,
    payout_amount: 21850, tds_amount: 437, net_payable_amount: 21413,
    status: 'paid', signature_status: 'signed',
    pdf_url: 'demo', signed_pdf_url: 'demo', signed_at: '2026-06-27T06:20:00Z',
    paid_at: '2026-06-29T18:30:00Z', created_at: '2026-06-26T09:10:00Z' },
  { id: 'demo-n2', debit_note_number: 'DN-2026-05-D002', month: 5, year: 2026,
    payout_amount: 15000, tds_amount: 300, net_payable_amount: 14700,
    status: 'paid', signature_status: 'signed',
    pdf_url: 'demo', signed_pdf_url: 'demo', signed_at: '2026-05-29T11:05:00Z',
    paid_at: '2026-05-31T18:30:00Z', created_at: '2026-05-28T08:40:00Z' },
  { id: 'demo-n1', debit_note_number: 'DN-2026-04-D001', month: 4, year: 2026,
    payout_amount: 71550, tds_amount: 1431, net_payable_amount: 70119,
    status: 'paid', signature_status: 'signed',
    pdf_url: 'demo', signed_pdf_url: 'demo', signed_at: '2026-04-26T05:55:00Z',
    paid_at: '2026-04-28T18:30:00Z', created_at: '2026-04-25T12:15:00Z' },
];

export const demoReferral: PartnerReferral = {
  ref_code: 'demo2026',
  active: true,
  clicks: 184,
  leads: 23,
  clients: 4,
};

export const demoLeads: PartnerLead[] = [
  { lead_id: 'demo-l1', lead_name: 'SURESH BABU', mobile: '90000 11111', city: 'CHENNAI',
    status: 'Converted', created_at: '2026-06-02T07:30:00Z', converted_client_code: 'NW-DEMO-0002' },
  { lead_id: 'demo-l2', lead_name: 'PRIYA VENKATESAN', mobile: '90000 22222', city: 'SALEM',
    status: 'In Progress', created_at: '2026-07-11T09:15:00Z', converted_client_code: null },
  { lead_id: 'demo-l3', lead_name: 'MOHAMMED ARIF', mobile: '90000 33333', city: 'TIRUCHIRAPPALLI',
    status: 'Submitted', created_at: '2026-07-24T11:45:00Z', converted_client_code: null },
  { lead_id: 'demo-l4', lead_name: 'LAKSHMI NARAYANAN', mobile: '90000 44444', city: 'ERODE',
    status: 'Closed', created_at: '2026-05-19T14:05:00Z', converted_client_code: null },
];
