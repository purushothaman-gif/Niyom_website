/**
 * ClientBridgeService — joins NIYOM's CRM clients to their BSE UCCs.
 *
 * The link is stored on `nw_clients.bse_ucc` (migration 20260731003000) and is
 * authoritative. PAN matching remains as a FALLBACK only, for clients that were
 * registered at BSE before the column existed — it is a heuristic (a blank or
 * mismatched PAN reads as "not registered"), so whenever the fallback resolves
 * a client we persist the link, and the next load uses the stored value.
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
  /** Stored BSE link (migration 20260731003000). Null until registered. */
  bse_ucc: string | null;
  bse_ucc_status: string | null;
}

export interface BridgedClient {
  crm: CrmClientLite;
  /** The client's BSE UCC, resolved from the stored link or (legacy) by PAN. */
  ucc: BseUccRow | null;
  /** True when the link came from PAN matching rather than the stored column. */
  linkedByPan: boolean;
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
          'id, client_code, full_name, email, phone, pan, dob, address, city, state, pincode, bank_account, bank_ifsc, onboarding_status, verification_status, pan_verified, bse_ucc, bse_ucc_status',
        )
        .order('created_at', { ascending: false })
        .limit(500),
      // A BSE outage shouldn't hide the CRM list — degrade to "unknown" instead.
      BseOpsService.uccs().catch(() => [] as BseUccRow[]),
    ]);
    if (error) throw new Error(error.message);

    const byCode = new Map(uccs.map((u) => [u.clientCode, u]));
    const byPan = new Map(uccs.filter((u) => norm(u.pan)).map((u) => [norm(u.pan), u]));

    const rows = ((data as CrmClientLite[]) ?? []).map((crm) => {
      const missing = missingFields(crm);
      // Stored link wins; PAN is only a fallback for pre-migration clients.
      const stored = crm.bse_ucc ? (byCode.get(crm.bse_ucc) ?? null) : null;
      const guessed = stored ? null : (byPan.get(norm(crm.pan)) ?? null);
      return {
        crm,
        ucc: stored ?? guessed,
        linkedByPan: Boolean(guessed),
        canRegister: missing.length === 0,
        missing,
      };
    });

    // Backfill: persist any link we had to infer, so it is stored next time.
    void this.backfillLinks(rows);
    return rows;
  },

  /**
   * Persist links that had to be inferred from PAN. Best-effort and silent —
   * this is an optimisation, never a reason to fail the page.
   */
  async backfillLinks(rows: BridgedClient[]): Promise<void> {
    const pending = rows.filter((r) => r.linkedByPan && r.ucc);
    for (const r of pending) {
      try {
        await supabase
          .from('nw_clients')
          .update({
            bse_ucc: r.ucc!.clientCode,
            bse_ucc_status: r.ucc!.status,
            bse_ucc_synced_at: new Date().toISOString(),
          })
          .eq('id', r.crm.id);
      } catch {
        /* ignore — the PAN fallback still resolves it next load */
      }
    }
  },

  /**
   * Register a CRM client at BSE as a physical, resident-individual UCC.
   * The proxy owns the BSE payload shape; we only supply the client's data.
   */
  async registerAtBse(c: CrmClientLite) {
    const [first, ...rest] = c.full_name.trim().split(/\s+/);
    const result = await BseOpsService.registerUcc({
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

    // Store the link immediately — losing it would strand the client in a
    // "not registered" state even though BSE now holds their UCC.
    try {
      await supabase
        .from('nw_clients')
        .update({
          bse_ucc: result.clientCode,
          bse_ucc_status: result.status,
          bse_ucc_synced_at: new Date().toISOString(),
        })
        .eq('id', c.id);
    } catch {
      /* BSE registration succeeded; the PAN fallback will resolve it meanwhile */
    }
    return result;
  },
};
