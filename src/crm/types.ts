export interface NWEmployee {
  id: string;
  auth_user_id: string;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string;
  role: 'super_admin' | 'admin' | 'employee'; // authorization only — never shown to clients
  designation: string | null;                 // display-only job title (Designated Partner, etc.)
  avatar_url: string | null;                   // profile photo (public URL in employee-avatars bucket); null → initials
  status: 'active' | 'inactive';
  password_changed: boolean;
  joining_date: string;
  created_at: string;
  updated_at: string;
}

export interface NWClient {
  id: string;
  client_code: string;
  employee_id: string | null;
  full_name: string;
  email: string;
  phone: string;
  pan: string;
  dob: string;
  /** M | F | O — required by BSE StAR MF when registering a UCC. */
  gender?: string | null;
  address: string;
  city: string;
  state: string;
  /** Added by migration 20260522204200; was missing from this interface. */
  pincode?: string | null;
  demat_account: string;
  dp_name: string;
  depository: string;
  bank_account: string;
  bank_ifsc: string;
  bank_name: string;
  verification_status: 'pending' | 'partial' | 'verified' | 'rejected';
  portfolio_value: number;
  notes: string;
  sourced_via: 'direct' | 'dsa';
  dsa_id: string | null;
  client_login_enabled: boolean;
  client_password_changed: boolean;
  client_auth_user_id: string | null;
  /** Profile photo (public URL in the client-avatars bucket); null → initials. */
  avatar_url?: string | null;
  // Progressive-onboarding funnel (see 20260725170000_onboarding_redesign.sql)
  phone_verified: boolean;
  pan_verified: boolean;
  pan_name: string | null;
  pan_doc_uploaded: boolean;
  bank_verified: boolean;
  cml_required: boolean;
  cml_uploaded: boolean;
  investment_preferences: string[];
  onboarding_status: 'account_created' | 'kyc_in_progress' | 'kyc_submitted' | 'kyc_under_review' | 'active';
  kyc_submitted_at: string | null;
  created_at: string;
  updated_at: string;
  employee?: { full_name: string; employee_code: string };
  dsa?: { full_name: string; dsa_code: string };
}

export interface NWDSA {
  id: string;
  dsa_code: string;
  employee_id: string;
  full_name: string;
  email: string;
  mobile: string;
  pan: string;
  address: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
  photo_url: string | null;
  pan_doc_url: string | null;
  bank_doc_url: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  employee?: { full_name: string; employee_code: string };
  // Partner Portal login (mirrors the nw_clients trio). Provisioned by an
  // RM/admin via the create-partner-login edge function; nw_current_dsa_id()
  // requires dsa_login_enabled AND status='active', so deactivating a DSA
  // instantly revokes portal access.
  dsa_auth_user_id?: string | null;
  dsa_login_enabled?: boolean;
  dsa_password_changed?: boolean;
  dsa_last_login_at?: string | null;
}

export type DSADebitNoteStatus = 'generated' | 'paid' | 'cancelled';
export type DSADebitNoteSignatureStatus = 'not_sent' | 'sent' | 'viewed' | 'signed';

export interface NWDSADebitNote {
  id: string;
  dsa_id: string;
  month: number;          // 1-12
  year: number;
  payout_amount: number;        // GROSS payout (before TDS)
  tds_amount: number;           // fixed 2% TDS deducted from the gross
  net_payable_amount: number;   // gross − TDS (amount actually paid out)
  debit_note_number: string;
  generated_at: string;
  pdf_url: string;
  created_by: string | null;
  // Payment status tracking
  status: DSADebitNoteStatus;
  paid_at: string | null;
  paid_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  // Future email support (schema prepared; sending not yet implemented)
  email_sent: boolean;
  email_sent_at: string | null;
  // Client (DSA) signing lifecycle — independent of payment `status`
  signature_status: DSADebitNoteSignatureStatus;
  secure_token: string | null;
  token_expires_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  sent_by: string | null;
  signer_email: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  signature_image_path: string | null;
  signed_pdf_url: string | null;   // stored separately from pdf_url (original preserved)
  pdf_snapshot: unknown | null;    // immutable render snapshot used for the signed copy
  created_at: string;
  updated_at: string;
  dsa?: { full_name: string; dsa_code: string };
  paid_by_employee?: { full_name: string } | null;
  cancelled_by_employee?: { full_name: string } | null;
  // PostgREST embedded aggregate: [{ count: n }]. Regenerate rebuilds a note
  // from its OWN covered transactions, so the line count is what decides
  // whether regeneration is possible — see DSAPayout.regenerateOne.
  dsa_debit_note_lines?: { count: number }[];
}

export interface NWClientDocument {
  id: string;
  client_id: string;
  doc_type: string;
  file_name: string;
  file_url: string;
  uploaded_by: string | null;
  created_at: string;
}

// Sprint 5: a client may hold up to 5 bank accounts (1 primary + 4 secondary).
// nw_clients.bank_* is the explicit application-maintained mirror of the primary.
export interface NWClientBankAccount {
  id: string;
  client_id: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  holder_name: string;
  label: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export type PayoutFrequency = 'annual' | 'halfyearly' | 'quarterly' | 'monthly';
export type SchemeType = 'equity' | 'debt' | 'hybrid' | 'index' | 'elss' | 'liquid' | 'others';
export type InsuranceType = 'term' | 'ulip' | 'traditional' | 'medical' | 'vehicle';
export type PremiumFrequency = 'monthly' | 'quarterly' | 'halfyearly' | 'annual' | 'single';

export interface NWHolding {
  id: string;
  client_id: string;
  product_type: ProductType;
  product_name: string;
  quantity: number;
  avg_cost: number;
  current_value: number;
  invested_amount: number;
  maturity_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
  // DSA pricing (unlisted_share, secondary_bond, primary_bond only)
  dsa_price?: number | null;
  client_price?: number | null;
  // MIS revenue fields
  landing_cost?: number | null;          // internal cost (unlisted/bonds)
  insurance_revenue?: number | null;     // flat revenue (insurance)
  trail_percent?: number | null;         // trail % p.a. (mutual fund)
  trail_start_date?: string | null;      // investment date for trail calc
  // Fixed Income
  isin?: string | null;
  face_value?: number | null;
  coupon_rate?: number | null;
  interest_payout_date?: string | null;
  payout_date_pattern?: string | null;
  payout_frequency?: string | null;
  interest_payout_amount?: number | null;
  issuer_name?: string;
  // Mutual Fund
  folio_number?: string;
  fund_house?: string;
  scheme_type?: string;
  nav_date?: string | null;
  purchase_nav?: number | null;
  current_nav?: number | null;
  // Insurance
  policy_number?: string;
  insurance_type?: string;
  insurer_name?: string;
  sum_assured?: number | null;
  premium_amount?: number | null;
  premium_frequency?: string;
  policy_start_date?: string | null;
  premium_due_date?: string | null;
  nominee_name?: string;
}

export interface NWTransaction {
  id: string;
  client_id: string;
  employee_id: string | null;
  txn_type: 'buy' | 'sell';
  product_type: ProductType;
  product_name: string;
  quantity: number | null;
  per_unit_price: number | null;
  consolidated_amount: number;
  txn_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
  // DSA pricing (unlisted_share, secondary_bond, primary_bond only)
  dsa_price?: number | null;
  client_price?: number | null;
  // MIS revenue fields
  landing_cost?: number | null;
  insurance_revenue?: number | null;
  trail_percent?: number | null;
  trail_start_date?: string | null;
  // Fixed Income
  isin?: string | null;
  face_value?: number | null;
  coupon_rate?: number | null;
  interest_payout_date?: string | null;
  payout_date_pattern?: string | null;
  payout_frequency?: string | null;
  issuer_name?: string;
  // Mutual Fund
  folio_number?: string;
  fund_house?: string;
  scheme_type?: string;
  nav_date?: string | null;
  purchase_nav?: number | null;
  // Insurance
  policy_number?: string;
  insurance_type?: string;
  insurer_name?: string;
  sum_assured?: number | null;
  premium_amount?: number | null;
  premium_frequency?: string;
  client?: { full_name: string; client_code: string };
  employee?: { full_name: string; employee_code: string };
  documents?: NWTxnDocument[];
}

export interface NWTxnDocument {
  id: string;
  txn_id: string;
  file_name: string;
  file_url: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface NWActivityLog {
  id: string;
  employee_id: string | null;
  client_id: string | null;
  action: string;
  /* Nullable in the database. 0 of 221 rows are actually null, but "always set
     so far" is not a constraint, and the generated schema is the truth. */
  description: string | null;
  created_at: string | null;
  /* A PostgREST embed yields null, not undefined, when there is no related row. */
  employee?: { full_name: string } | null;
  client?: { full_name: string } | null;
}

export interface NWAlert {
  id: string;
  /* Nullable in the database — an alert with no owner is possible there even
     though nothing writes one today. Matching the schema rather than the habit. */
  employee_id: string | null;
  title: string;
  /* Nullable in the database, both of them. */
  message: string | null;
  read: boolean | null;
  created_at: string | null;
  // Additive columns from the Lead Management module (nullable).
  category?: string | null;
  lead_id?: string | null;
  action_url?: string | null;
}

export type ProductType = 'unlisted_share' | 'secondary_bond' | 'primary_bond' | 'mutual_fund' | 'fixed_deposit' | 'insurance';

export type CRMPage =
  | 'dashboard'
  | 'leads'
  | 'onboarding'
  | 'clients'
  | 'portfolio'
  | 'transactions'
  | 'reports'
  | 'bonds'
  | 'marketing_content'
  | 'mis'
  | 'dsa_payout'
  | 'dsa_management'
  | 'documents'
  | 'admin_documents'
  | 'employees'
  | 'deal_confirmation'
  | 'transfer_queue'
  | 'support_tickets'
  | 'settings';
