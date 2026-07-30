/**
 * ClientBridgeService — joins NIYOM's CRM clients to their BSE UCCs.
 *
 * There is no stored link between the two: `nw_clients` has no UCC column, so
 * we match on PAN, which both sides carry and which BSE treats as the holder's
 * identity. That is a heuristic — a client whose CRM PAN is blank or differs
 * from the one registered at BSE will show as "not registered". Storing the UCC
 * on the client row is the durable fix (needs a migration).
 */
import { supabase } from '../../lib/supabase';
import { BseOpsService, type BseUccRow } from './BseOpsService';

/** The CRM fields we need to both display and register a client at BSE. */
export interface CrmClientLite {
  id: string;
  client_code: string;
  full_name: string;
  email: string;
  phone: string;
  pan: string;
  dob: string;
  address: string;
  city: string;
  state: string;
  /** Present in nw_clients since migration 20260522204200 (absent from NWClient). */
  pincode: string;
  bank_account: string;
  bank_ifsc: string;
  onboarding_status: string;
  verification_status: string;
  pan_verified: boolean;
}

export interface BridgedClient {
  crm: CrmClientLite;
  /** The matching BSE UCC, if this client's PAN is registered. */
  ucc: BseUccRow | null;
  /** Everything BSE needs is present, so registration can be attempted. */
  canRegister: boolean;
  /** What's missing when it can't. */
  missing: string[];
}

const norm = (pan: string | null | undefined) => (pan ?? '').trim().toUpperCase();

/** Fields BSE requires in add_ucc that the CRM must therefore supply. */
function missingFields(c: CrmClientLite): string[] {
  const gaps: string[] = [];
  if (!norm(c.pan)) gaps.push('PAN');
  if (!c.full_name?.trim()) gaps.push('name');
  if (!c.dob) gaps.push('date of birth');
  if (!c.email?.trim()) gaps.push('email');
  if (!c.phone?.trim()) gaps.push('mobile');
  if (!c.bank_account?.trim()) gaps.push('bank account');
  if (!c.bank_ifsc?.trim()) gaps.push('IFSC');
  if (!c.city?.trim() || !c.state?.trim()) gaps.push('address');
  if (!c.pincode?.trim()) gaps.push('pincode');
  return gaps;
}

export const ClientBridgeService = {
  /** CRM clients joined to their BSE UCC by PAN. */
  async list(): Promise<BridgedClient[]> {
    const [{ data, error }, uccs] = await Promise.all([
      supabase
        .from('nw_clients')
        .select(
          'id, client_code, full_name, email, phone, pan, dob, address, city, state, pincode, bank_account, bank_ifsc, onboarding_status, verification_status, pan_verified',
        )
        .order('created_at', { ascending: false })
        .limit(500),
      // A BSE outage shouldn't hide the CRM list — degrade to "unknown" instead.
      BseOpsService.uccs().catch(() => [] as BseUccRow[]),
    ]);
    if (error) throw new Error(error.message);

    const byPan = new Map(uccs.filter((u) => norm(u.pan)).map((u) => [norm(u.pan), u]));

    return ((data as CrmClientLite[]) ?? []).map((crm) => {
      const missing = missingFields(crm);
      return {
        crm,
        ucc: byPan.get(norm(crm.pan)) ?? null,
        canRegister: missing.length === 0,
        missing,
      };
    });
  },

  /**
   * Register a CRM client at BSE as a physical, resident-individual UCC.
   * The proxy owns the BSE payload shape; we only supply the client's data.
   */
  async registerAtBse(c: CrmClientLite) {
    const [first, ...rest] = c.full_name.trim().split(/\s+/);
    return BseOpsService.registerUcc({
      // BSE's client_code must be unique per member; the CRM code is already so.
      clientCode: c.client_code,
      pan: norm(c.pan),
      firstName: first ?? c.full_name,
      middleName: rest.length > 1 ? rest.slice(0, -1).join(' ') : '',
      lastName: rest.length ? rest[rest.length - 1] : '',
      dob: c.dob,
      gender: 'M',
      email: c.email.trim(),
      mobile: c.phone.replace(/\D/g, '').slice(-10),
      address: {
        line1: c.address?.trim() || c.city,
        city: c.city,
        state: c.state,
        pincode: c.pincode.trim(),
      },
      bank: { accountNumber: c.bank_account.trim(), ifsc: c.bank_ifsc.trim().toUpperCase() },
    });
  },
};
