/**
 * Validation for client profile self-service. Pure (no Deno, no I/O) so the
 * rules that gate a client's own KYC-adjacent details are unit-tested.
 */

export interface ContactChange {
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface NomineeInput {
  full_name: string;
  relationship: string;
  dob?: string | null;
  share_percent: number;
  guardian_name?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
}

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeMobile(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

/** Contact details: only fields actually supplied are validated and returned. */
export function validateContact(input: ContactChange): Check<ContactChange> {
  const out: ContactChange = {};
  if (input.phone !== undefined) {
    const p = normalizeMobile(input.phone);
    if (!/^[6-9]\d{9}$/.test(p)) return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' };
    out.phone = p;
  }
  if (input.email !== undefined) {
    const e = input.email.trim().toLowerCase();
    if (!EMAIL.test(e) || e.length > 120) return { ok: false, error: 'Enter a valid email address.' };
    out.email = e;
  }
  if (input.address !== undefined) {
    const a = input.address.trim().replace(/\s+/g, ' ');
    if (a.length < 8 || a.length > 300) return { ok: false, error: 'Address should be 8 to 300 characters.' };
    out.address = a;
  }
  if (input.city !== undefined) {
    const c = input.city.trim();
    if (c.length < 2 || c.length > 60) return { ok: false, error: 'Enter a valid city.' };
    out.city = c;
  }
  if (input.state !== undefined) {
    const s = input.state.trim();
    if (s.length < 2 || s.length > 60) return { ok: false, error: 'Enter a valid state.' };
    out.state = s;
  }
  if (input.pincode !== undefined) {
    const pin = input.pincode.trim();
    if (!/^[1-9]\d{5}$/.test(pin)) return { ok: false, error: 'Enter a valid 6-digit PIN code.' };
    out.pincode = pin;
  }
  if (!Object.keys(out).length) return { ok: false, error: 'Nothing to change.' };
  return { ok: true, value: out };
}

export function ageOn(dob: string, today = new Date()): number | null {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  let age = today.getUTCFullYear() - d.getUTCFullYear();
  const m = today.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/**
 * Nominees, as a full replacement list: up to MAX_NOMINEES (SEBI's 2025
 * nomination revamp allows up to 10 for MF folios and demat), shares must
 * total exactly 100%, a minor needs a guardian. An empty list clears nominees
 * (the client is opting out).
 */
export const MAX_NOMINEES = 10;

export function validateNominees(list: NomineeInput[], today = new Date()): Check<NomineeInput[]> {
  if (!Array.isArray(list)) return { ok: false, error: 'Invalid nominee list.' };
  if (list.length > MAX_NOMINEES) return { ok: false, error: `You can add up to ${MAX_NOMINEES} nominees.` };
  if (list.length === 0) return { ok: true, value: [] };
  const out: NomineeInput[] = [];
  let total = 0;
  for (const [i, n] of list.entries()) {
    const label = `Nominee ${i + 1}`;
    const name = (n.full_name ?? '').trim().replace(/\s+/g, ' ');
    const rel = (n.relationship ?? '').trim();
    if (name.length < 2) return { ok: false, error: `${label}: enter the full name.` };
    if (rel.length < 2) return { ok: false, error: `${label}: choose the relationship.` };
    const share = Number(n.share_percent);
    if (!Number.isFinite(share) || share <= 0 || share > 100) return { ok: false, error: `${label}: share must be between 1 and 100%.` };
    if (Math.round(share * 100) !== share * 100) return { ok: false, error: `${label}: share can have at most 2 decimals.` };
    let dob: string | null = null;
    let guardian: string | null = null;
    if (n.dob) {
      const age = ageOn(n.dob, today);
      if (age === null || age < 0 || age > 120) return { ok: false, error: `${label}: enter a valid date of birth.` };
      dob = n.dob;
      if (age < 18) {
        guardian = (n.guardian_name ?? '').trim();
        if (guardian.length < 2) return { ok: false, error: `${label} is a minor — enter the guardian's name.` };
      }
    }
    if (n.mobile) {
      const m = normalizeMobile(n.mobile);
      if (!/^[6-9]\d{9}$/.test(m)) return { ok: false, error: `${label}: enter a valid mobile number or leave it blank.` };
    }
    if (n.email && !EMAIL.test(n.email.trim())) return { ok: false, error: `${label}: enter a valid email or leave it blank.` };
    total += share;
    out.push({
      full_name: name,
      relationship: rel,
      dob,
      share_percent: share,
      guardian_name: guardian,
      mobile: n.mobile ? normalizeMobile(n.mobile) : null,
      email: n.email ? n.email.trim().toLowerCase() : null,
      address: n.address ? n.address.trim().slice(0, 300) : null,
    });
  }
  if (Math.abs(total - 100) > 0.001) return { ok: false, error: `Shares must add up to 100% (now ${total}%).` };
  return { ok: true, value: out };
}

export interface BankInput {
  account_number: string;
  ifsc: string;
  holder_name?: string;
  label?: string;
  make_primary?: boolean;
}

export function validateBank(b: BankInput): Check<BankInput> {
  const acc = (b.account_number ?? '').replace(/\s+/g, '');
  const ifsc = (b.ifsc ?? '').trim().toUpperCase();
  if (!/^[A-Za-z0-9]{6,40}$/.test(acc)) return { ok: false, error: 'Enter a valid account number.' };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { ok: false, error: 'Enter a valid 11-character IFSC (e.g. HDFC0001234).' };
  return {
    ok: true,
    value: {
      account_number: acc,
      ifsc,
      holder_name: b.holder_name?.trim().slice(0, 100) || undefined,
      label: b.label?.trim().slice(0, 40) || undefined,
      make_primary: !!b.make_primary,
    },
  };
}

/**
 * Cashfree's name_match_result → accept? A poor or no match means the account
 * is probably not the client's own, which must not be accepted silently.
 */
export function bankNameAcceptable(result: string | null | undefined): boolean {
  return ['DIRECT_MATCH', 'GOOD_PARTIAL_MATCH', 'MODERATE_PARTIAL_MATCH'].includes(String(result ?? '').toUpperCase());
}

export function maskAccount(acc: string | null | undefined): string {
  const a = String(acc ?? '');
  return a.length <= 4 ? a : `XXXX${a.slice(-4)}`;
}
