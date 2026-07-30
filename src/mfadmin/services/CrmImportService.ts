/**
 * CrmImportService — an optional source of typing, not a dependency.
 *
 * The MF Admin console stands alone: BSE owns the UCC, and no screen here reads
 * CRM data to display it. This module exists only so that registering a client
 * who already exists in the CRM doesn't mean re-typing their details, and it is
 * used at exactly one moment — prefilling the registration form. Nothing calls
 * it afterwards, and the console works normally if the CRM is empty or
 * unreachable.
 *
 * Accuracy is the real reason, not convenience: `pan_name` here is the name
 * Cashfree returned for the PAN, and BSE's KYC check compares the holder name
 * against exactly that. Hand-typing names is how a UCC ends up stuck.
 */
import { supabase } from '../../lib/supabase';

export interface CrmClientLookup {
  id: string;
  clientCode: string;
  fullName: string;
  /** Name as registered against the PAN — preferred over fullName for BSE. */
  panName: string | null;
  panVerified: boolean;
  pan: string;
  dob: string;
  gender: string | null;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  bankAccount: string;
  bankIfsc: string;
  /** Fields BSE requires that this client is missing. */
  missing: string[];
}

const REQUIRED: [keyof CrmClientLookup, string][] = [
  ['pan', 'PAN'],
  ['dob', 'date of birth'],
  ['gender', 'gender'],
  ['email', 'email'],
  ['phone', 'mobile'],
  ['city', 'city'],
  ['state', 'state'],
  ['pincode', 'pincode'],
  ['bankAccount', 'bank account'],
  ['bankIfsc', 'IFSC'],
];

function shape(r: Record<string, unknown>): CrmClientLookup {
  const c: CrmClientLookup = {
    id: String(r.id ?? ''),
    clientCode: String(r.client_code ?? ''),
    fullName: String(r.full_name ?? ''),
    panName: (r.pan_name as string) || null,
    panVerified: Boolean(r.pan_verified),
    pan: String(r.pan ?? '').toUpperCase(),
    dob: String(r.dob ?? ''),
    gender: (r.gender as string) || null,
    email: String(r.email ?? ''),
    phone: String(r.phone ?? ''),
    address: String(r.address ?? ''),
    city: String(r.city ?? ''),
    state: String(r.state ?? ''),
    pincode: String(r.pincode ?? ''),
    bankAccount: String(r.bank_account ?? ''),
    bankIfsc: String(r.bank_ifsc ?? '').toUpperCase(),
    missing: [],
  };
  c.missing = REQUIRED.filter(([k]) => !String(c[k] ?? '').trim()).map(([, label]) => label);
  return c;
}

const COLUMNS =
  'id, client_code, full_name, pan_name, pan_verified, pan, dob, gender, email, phone, address, city, state, pincode, bank_account, bank_ifsc';

export const CrmImportService = {
  /**
   * Record the UCC BSE assigned against the CRM client.
   *
   * This is what lets the proxy answer "which UCC does this caller own?" when
   * the client later signs into the portal — without it they cannot transact,
   * however complete their BSE registration is. Best-effort: registration at
   * BSE has already succeeded by this point and must not be reported as failed.
   */
  async linkUcc(clientId: string, ucc: string, status: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('nw_clients')
        .update({
          bse_ucc: ucc,
          bse_ucc_status: status,
          bse_ucc_synced_at: new Date().toISOString(),
        })
        .eq('id', clientId);
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Search CRM clients by name, code or PAN. Returns [] rather than throwing if
   * the CRM is unavailable — this is a convenience, and it must never be the
   * reason a client can't be registered at BSE.
   */
  async search(term: string): Promise<CrmClientLookup[]> {
    const q = term.trim();
    if (q.length < 2) return [];
    try {
      const { data, error } = await supabase
        .from('nw_clients')
        .select(COLUMNS)
        .or(`full_name.ilike.%${q}%,client_code.ilike.%${q}%,pan.ilike.%${q}%`)
        .limit(20);
      if (error) return [];
      return ((data as Record<string, unknown>[]) ?? []).map(shape);
    } catch {
      return [];
    }
  },
};
