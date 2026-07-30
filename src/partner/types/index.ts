/**
 * Partner Portal types.
 *
 * These mirror the RETURNS TABLE shapes of the nw_partner_* SECURITY DEFINER
 * RPCs, which are the ONLY way the partner portal reads data. Partners have no
 * table access to nw_clients / nw_holdings / nw_transactions — RLS grants rows,
 * not columns, so a table policy would expose PAN, bank, DOB and the firm's
 * margin fields to anyone who wrote `?select=*`. Every column below is one the
 * RPC deliberately projects.
 */

/** nw_partner_profile() — the signed-in partner plus their RM card. */
export interface PartnerIdentity {
  dsa_id: string;
  dsa_code: string;
  full_name: string;
  email: string;
  mobile: string;
  /** Masked server-side (XXXXX + last 5). The raw PAN is never sent. */
  pan_masked: string;
  address: string;
  bank_name: string;
  /** Masked server-side (XXXXXX + last 4). */
  bank_account_masked: string;
  bank_ifsc: string;
  status: string;
  photo_url: string | null;
  login_enabled: boolean;
  password_changed: boolean;
  partner_since: string | null;
  rm_name: string | null;
  rm_email: string | null;
  /** nw_employees stores this as `phone`; the RPC aliases it for the RM card. */
  rm_mobile: string | null;
  /** From the PUBLIC employee-avatars bucket, so this URL was already public. */
  rm_avatar_url: string | null;
}

/** nw_partner_clients() — one row per client this partner sourced. */
export interface PartnerClientRow {
  client_id: string;
  client_code: string;
  full_name: string;
  city: string;
  /** Masked server-side (last 4 only). */
  mobile_masked: string;
  onboarding_status: string;
  verification_status: string;
  sourced_on: string | null;
  invested_amount: number;
  current_value: number;
  holdings_count: number;
}

/** nw_partner_client_portfolio() — holdings of one sourced client. */
export interface PartnerHoldingRow {
  holding_id: string;
  product_type: string;
  product_name: string;
  quantity: number;
  avg_price: number;
  invested_amount: number;
  current_value: number;
  gain_loss: number;
}

/** nw_partner_client_transactions() — deal history of one sourced client. */
export interface PartnerTransactionRow {
  txn_id: string;
  txn_date: string;
  txn_type: string;
  product_type: string;
  product_name: string;
  quantity: number;
  amount: number;
  /** The partner's own deal economics — the basis of their payout. */
  dsa_price: number | null;
  client_price: number | null;
}

/**
 * nw_partner_payout_summary() — aggregates over debit notes ONLY.
 *
 * Every figure here is read from a note that has already been raised and
 * frozen. The payout formula itself lives solely in src/crm/DSAPayout.tsx and is
 * deliberately NOT reimplemented: two implementations would diverge, and the
 * divergent number is the one shown to a counterparty. dsa_debit_notes is the
 * legal artefact (signed, immutable, with a pdf_snapshot), so mirroring it means
 * the portal can never contradict the document the partner signed.
 */
export interface PartnerPayoutSummary {
  fy_label: string;
  fy_gross: number;
  fy_tds: number;
  fy_net: number;
  lifetime_gross: number;
  lifetime_tds: number;
  lifetime_net: number;
  paid_net: number;
  awaiting_signature_count: number;
  awaiting_payment_net: number;
  latest_note_number: string | null;
  latest_note_period: string | null;
  latest_note_net: number | null;
}

/** nw_partner_debit_notes() — one row per statement raised for this partner. */
export interface PartnerDebitNote {
  id: string;
  debit_note_number: string;
  month: number;
  year: number;
  payout_amount: number;
  tds_amount: number;
  net_payable_amount: number;
  status: string;
  signature_status: string;
  pdf_url: string | null;
  signed_pdf_url: string | null;
  signed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

/** nw_partner_leads() — leads this partner submitted, with a simplified status. */
export interface PartnerLead {
  lead_id: string;
  lead_name: string;
  mobile: string;
  city: string;
  /**
   * Mapped, not raw. The CRM workflow has ~18 values including 'Not Interested'
   * and 'Wrong Number', which should not be shown verbatim to a partner.
   */
  status: 'Submitted' | 'In Progress' | 'Converted' | 'Closed';
  created_at: string;
  converted_client_code: string | null;
}

/** The partner's referral link, from mkt_referral_links where kind='dsa'. */
export interface PartnerReferral {
  ref_code: string;
  active: boolean;
  clicks: number;
  leads: number;
  clients: number;
}
