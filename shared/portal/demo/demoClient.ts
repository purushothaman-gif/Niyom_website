/**
 * Client Portal — demo mode.
 *
 * The client-side twin of shared/partner/demo/demoData.ts, and it follows the
 * same three rules:
 *
 *   - FRONT-END ONLY. No auth user, no Supabase session, no rows in any table.
 *     Nothing here can appear in Manage Clients, Reports, Transactions, MIS
 *     revenue or a DSA payout, all of which read the real tables unfiltered.
 *   - Every person, security, amount and document below is INVENTED, and the
 *     securities must stay invented. A sample portfolio showing a gain against
 *     a named real fund is a performance claim about that product the moment
 *     the portal is screen-shared or filmed.
 *   - Read-only. Every write path short-circuits to a believable acknowledgement
 *     so a prospect can walk the whole flow without creating anything.
 *
 * These credentials are meant to be handed out and will be shared onward, so
 * they must never unlock anything real. They don't: ClientLogin recognises them
 * locally and never calls the PAN lookup, so there is no account behind them.
 */
import type { NWClient, NWClientBankAccount, NWTransaction } from '../../crm/types';
import type { ClientWealthSnapshot } from '../services/HoldingService';
import type { PortalHolding } from '../types/cas';
import type { ClientDocument } from '../types/activity';
import { ephemeralGet, ephemeralRemove, ephemeralSet } from '../../platform/ephemeralStore';
import { resetDemoClientMarket } from './demoClientMarket';

export const DEMO_CLIENT_PAN = 'NIYOM5678C';
export const DEMO_CLIENT_PASSWORD = 'NiyomDemo@2026';

/** Not a real nw_clients.id — nothing resolves it server-side. */
export const DEMO_CLIENT_ID = 'demo-client';

const KEY = 'nw_client_demo';

export function startDemoClientSession() {
  ephemeralSet(KEY, '1');
}
export function endDemoClientSession() {
  ephemeralRemove(KEY);
  resetDemoClientMarket();
}
export function isDemoClientSession(): boolean {
  return ephemeralGet(KEY) === '1';
}

/** Case/space-insensitive match on the published demo credentials. */
export function isDemoClientCredentials(pan: string, password: string): boolean {
  return pan.trim().toUpperCase() === DEMO_CLIENT_PAN && password === DEMO_CLIENT_PASSWORD;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export const demoClientRecord: NWClient = {
  id: DEMO_CLIENT_ID,
  client_code: 'NW-DEMO-C001',
  employee_id: null,
  full_name: 'ARJUN RAMANATHAN',
  email: 'arjun.demo@niyomwealth.com',
  phone: '9000000000',
  pan: 'XXXXX5678C',
  dob: '1986-04-17',
  gender: 'M',
  address: 'Demo address — shown only in the sample portal',
  city: 'CHENNAI',
  state: 'TAMIL NADU',
  pincode: '600028',
  demat_account: 'XXXXXXXX9014',
  dp_name: 'Sample Depository Participant',
  depository: 'CDSL',
  bank_account: 'XXXXXX7788',
  bank_ifsc: 'HDFC0000123',
  bank_name: 'HDFC BANK',
  verification_status: 'verified',
  portfolio_value: 2459550,
  notes: '',
  sourced_via: 'direct',
  dsa_id: null,
  client_login_enabled: true,
  client_password_changed: true,
  client_auth_user_id: null,
  avatar_url: null,
  phone_verified: true,
  pan_verified: true,
  pan_name: 'ARJUN RAMANATHAN',
  pan_doc_uploaded: true,
  bank_verified: true,
  cml_required: true,
  cml_uploaded: true,
  investment_preferences: ['Mutual Funds', 'Bonds', 'Unlisted Shares'],
  onboarding_status: 'active',
  kyc_submitted_at: '2024-03-08T06:30:00.000Z',
  created_at: '2024-03-02T09:15:00.000Z',
  updated_at: '2026-08-21T11:40:00.000Z',
  employee: { full_name: 'Your Relationship Manager', employee_code: 'NW-RM-DEMO' },
};

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

const holding = (
  id: string,
  product_type: PortalHolding['product_type'],
  product_name: string,
  quantity: number,
  avg_cost: number,
  invested_amount: number,
  current_value: number,
  extra: Partial<PortalHolding> = {},
): PortalHolding => ({
  id,
  client_id: DEMO_CLIENT_ID,
  product_type,
  product_name,
  quantity,
  avg_cost,
  current_value,
  invested_amount,
  maturity_date: '',
  notes: '',
  created_at: '2024-03-12T00:00:00.000Z',
  updated_at: '2026-08-29T00:00:00.000Z',
  ...extra,
});

/** ~₹24.6 L across three asset classes, up ~14% on ~₹21.5 L invested. */
export const demoHoldings: PortalHolding[] = [
  holding('demo-h1', 'mutual_fund', 'Sample Flexi Cap Fund — Growth', 8420.55, 62.4, 525442, 648300, {
    isin: 'INF000DEMO01',
  }),
  holding('demo-h2', 'mutual_fund', 'Sample Balanced Advantage Fund — Growth', 12500, 40, 500000, 561250, {
    isin: 'INF000DEMO02',
  }),
  holding('demo-h3', 'mutual_fund', 'Sample Mid Cap Fund — Growth', 3100.2, 96.75, 299944, 372400, {
    isin: 'INF000DEMO03',
  }),
  holding('demo-h4', 'secondary_bond', '9.75% Meridian Infra Finance Ltd 2029', 5, 101482, 507410, 519800, {
    isin: 'INE0DEMO1011',
    face_value: 100000,
    coupon_rate: 9.75,
    maturity_date: '2029-11-20',
  }),
  holding('demo-h5', 'unlisted_share', 'Velan Aerospace Private Limited', 400, 512, 204800, 236000, {
    isin: 'INE0DEMOS011',
  }),
  holding('demo-h6', 'unlisted_share', 'Thamarai Foods Limited', 600, 187.5, 112500, 121800, {
    isin: 'INE0DEMOS022',
  }),
];

const txn = (
  id: string,
  txn_date: string,
  product_type: NWTransaction['product_type'],
  product_name: string,
  quantity: number | null,
  per_unit_price: number | null,
  consolidated_amount: number,
  txn_type: 'buy' | 'sell' = 'buy',
): NWTransaction => ({
  id,
  client_id: DEMO_CLIENT_ID,
  employee_id: null,
  txn_type,
  product_type,
  product_name,
  quantity,
  per_unit_price,
  consolidated_amount,
  txn_date,
  notes: '',
  created_at: `${txn_date}T05:30:00.000Z`,
  updated_at: `${txn_date}T05:30:00.000Z`,
});

/**
 * Spread across two and a half years so the money-weighted return has real
 * flows to work with — a single lump sum would compute, but it would not look
 * like anyone's actual investing.
 */
export const demoClientTransactions: NWTransaction[] = [
  txn('demo-t1', '2024-03-12', 'mutual_fund', 'Sample Flexi Cap Fund — Growth', 3205.13, 46.8, 150000),
  txn('demo-t2', '2024-06-18', 'mutual_fund', 'Sample Balanced Advantage Fund — Growth', 5000, 36, 180000),
  txn('demo-t3', '2024-09-05', 'unlisted_share', 'Velan Aerospace Private Limited', 200, 468, 93600),
  txn('demo-t4', '2025-01-22', 'mutual_fund', 'Sample Flexi Cap Fund — Growth', 2604.17, 57.6, 150000),
  txn('demo-t5', '2025-04-30', 'secondary_bond', '9.75% Meridian Infra Finance Ltd 2029', 3, 100900, 302700),
  txn('demo-t6', '2025-07-14', 'mutual_fund', 'Sample Mid Cap Fund — Growth', 1612.9, 93, 149999),
  txn('demo-t7', '2025-11-03', 'unlisted_share', 'Thamarai Foods Limited', 600, 187.5, 112500),
  txn('demo-t8', '2026-02-11', 'mutual_fund', 'Sample Balanced Advantage Fund — Growth', 7500, 42.67, 320025),
  txn('demo-t9', '2026-04-08', 'unlisted_share', 'Velan Aerospace Private Limited', 200, 556, 111200),
  txn('demo-t10', '2026-06-24', 'secondary_bond', '9.75% Meridian Infra Finance Ltd 2029', 2, 102355, 204710),
];

export function demoSnapshot(): ClientWealthSnapshot {
  return {
    client: demoClientRecord,
    holdings: demoHoldings,
    transactions: demoClientTransactions,
    // 'manual' rather than 'cas': the sample book has no imported statement, so
    // there is no statement date to honour and the transactions above are the
    // only cash flows. Claiming 'cas' would strip the mutual fund rows out of
    // the return and leave it computed from three bond and share flows.
    mfSource: 'manual',
    casStatementTo: null,
    casFreshness: { state: 'none', statementTo: null, latestOwnMfTxnDate: '2026-06-24' },
    casFlows: [],
    historyComplete: true,
    casStatementFrom: null,
    dayChange: 4820,
    valuedOn: null,
  };
}

export const demoBankAccounts: NWClientBankAccount[] = [
  {
    id: 'demo-bank-1',
    client_id: DEMO_CLIENT_ID,
    bank_name: 'HDFC BANK',
    account_number: 'XXXXXX7788',
    ifsc: 'HDFC0000123',
    holder_name: 'ARJUN RAMANATHAN',
    label: 'Primary',
    is_primary: true,
    created_at: '2024-03-08T06:30:00.000Z',
    updated_at: '2024-03-08T06:30:00.000Z',
  },
];

export const demoDocuments: ClientDocument[] = [
  {
    id: 'demo-doc-1',
    fileName: 'Deal-Confirmation-DC-2026-06-0184.pdf',
    docType: 'deal_confirmation',
    docTypeLabel: 'Deal Confirmation',
    filePath: 'demo/deal-confirmation.pdf',
    fileSize: 184320,
    mimeType: 'application/pdf',
    uploadedAt: '2026-06-24T11:05:00.000Z',
  },
  {
    id: 'demo-doc-2',
    fileName: 'Deal-Confirmation-DC-2025-04-0092.pdf',
    docType: 'deal_confirmation',
    docTypeLabel: 'Deal Confirmation',
    filePath: 'demo/deal-confirmation-2.pdf',
    fileSize: 176128,
    mimeType: 'application/pdf',
    uploadedAt: '2025-04-30T09:20:00.000Z',
  },
  {
    id: 'demo-doc-3',
    fileName: 'KYC-Acknowledgement.pdf',
    docType: 'kyc',
    docTypeLabel: 'KYC',
    filePath: 'demo/kyc-ack.pdf',
    fileSize: 98304,
    mimeType: 'application/pdf',
    uploadedAt: '2024-03-08T07:00:00.000Z',
  },
];
