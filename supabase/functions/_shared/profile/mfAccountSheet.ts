/**
 * MF account sheet — everything a mutual-fund account needs for one client,
 * laid out the way an exchange account (BSE StAR MF UCC), its nomination and
 * its bank mandate ask for it, with the BSE code beside each coded value.
 *
 * It is platform-neutral on purpose. Today staff use it to open the account
 * on the platform clients invest through; when Niyom registers accounts at
 * BSE directly, the same rows are what the API call is built from. `missing`
 * says what still has to be collected before either can happen.
 *
 * Pure: no I/O, so the readiness rules are unit-tested.
 */
import { countryName } from './countries.ts';
import {
  BANK_ACCOUNT_TYPES, CONTACT_OWNERS, GENDERS, INCOME_SLABS, MANDATE_PREFERENCES, NOMINEE_ID_TYPES,
  OCCUPATIONS, PEP_STATUSES, WEALTH_SOURCES, labelOf,
} from './investorProfile.ts';
import {
  BANK_ACC_TYPE_CODE, CONTACT_OWNER_CODE, GUARDIAN_RELATION_CODE, INCOME_SLAB_CODE, MANDATE_TYPE_CODE,
  NOMINEE_RELATION_CODE, OCC_CODE, PEP_CODE, WEALTH_SOURCE_CODE,
} from './bseCodes.ts';

export interface SheetClient {
  client_code?: string | null;
  full_name?: string | null;
  pan_name?: string | null;
  pan?: string | null;
  pan_verified?: boolean | null;
  dob?: string | null;
  gender?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_ifsc?: string | null;
  bank_account_type?: string | null;
  bank_verified?: boolean | null;
  occupation?: string | null;
  income_slab?: string | null;
  wealth_source?: string | null;
  pep_status?: string | null;
  birth_place?: string | null;
  birth_country?: string | null;
  tax_resident_outside_india?: boolean | null;
  foreign_tax_country?: string | null;
  foreign_tax_id?: string | null;
  father_name?: string | null;
  spouse_name?: string | null;
  mobile_belongs_to?: string | null;
  email_belongs_to?: string | null;
  nomination_choice?: string | null;
  mandate_preference?: string | null;
  mandate_max_amount?: number | string | null;
  mandate_upi_id?: string | null;
  investor_profile_completed_at?: string | null;
  investor_profile_source?: string | null;
  kra_status?: string | null;
}

export interface SheetNominee {
  full_name?: string | null;
  relationship?: string | null;
  dob?: string | null;
  share_percent?: number | string | null;
  id_type?: string | null;
  id_number?: string | null;
  guardian_name?: string | null;
  guardian_dob?: string | null;
  guardian_pan?: string | null;
  guardian_relationship?: string | null;
}

export interface SheetRow {
  section: 'Account holder' | 'Contact' | 'Bank' | 'Declaration (FATCA)' | 'Nomination' | 'Auto-debit (mandate)';
  label: string;
  value: string;
  /** The BSE StAR MF code for this value, where the field is a coded one. */
  bseCode?: string;
}

export interface MfAccountSheet {
  rows: SheetRow[];
  /** What must still be collected before an account can be opened. */
  missing: string[];
  /** Not blocking, but staff should know. */
  notes: string[];
  ready: boolean;
}

const txt = (v: unknown): string => String(v ?? '').trim();

export function buildMfAccountSheet(c: SheetClient, nominees: SheetNominee[]): MfAccountSheet {
  const rows: SheetRow[] = [];
  const missing: string[] = [];
  const notes: string[] = [];
  const add = (section: SheetRow['section'], label: string, value: string, bseCode?: string) =>
    rows.push({ section, label, value: value || '—', ...(bseCode ? { bseCode } : {}) });
  const need = (ok: boolean, what: string) => { if (!ok) missing.push(what); };

  // ── Account holder ──
  const name = txt(c.pan_name) || txt(c.full_name);
  add('Account holder', 'Client code', txt(c.client_code));
  add('Account holder', 'Name (as per PAN)', name);
  add('Account holder', 'PAN', txt(c.pan).toUpperCase());
  add('Account holder', 'Date of birth', txt(c.dob));
  add('Account holder', 'Gender', labelOf(GENDERS, c.gender), txt(c.gender) || undefined);
  add('Account holder', 'Holding / tax status', 'Single · Resident individual', 'SI / 01');
  add('Account holder', 'KYC (KRA) status', txt(c.kra_status) || 'Not checked');
  need(!!name, 'name');
  need(/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(txt(c.pan).toUpperCase()), 'PAN');
  if (txt(c.pan) && !c.pan_verified) notes.push('PAN is on record but not verified.');
  need(!!txt(c.dob), 'date of birth');
  need(['M', 'F', 'O'].includes(txt(c.gender)), 'gender');

  // ── Contact ──
  add('Contact', 'Mobile', txt(c.phone));
  add('Contact', 'Mobile belongs to', labelOf(CONTACT_OWNERS, c.mobile_belongs_to), CONTACT_OWNER_CODE[txt(c.mobile_belongs_to)]);
  add('Contact', 'Email', txt(c.email));
  add('Contact', 'Email belongs to', labelOf(CONTACT_OWNERS, c.email_belongs_to), CONTACT_OWNER_CODE[txt(c.email_belongs_to)]);
  add('Contact', 'Address', txt(c.address));
  add('Contact', 'City / State / PIN', [txt(c.city), txt(c.state), txt(c.pincode)].filter(Boolean).join(' · '));
  need(/^\d{10}$/.test(txt(c.phone).replace(/\D/g, '').slice(-10)), 'mobile number');
  need(/^\S+@\S+\.\S+$/.test(txt(c.email)), 'email');
  need(txt(c.address).length >= 10, 'full address (10+ characters)');
  need(!!txt(c.city) && !!txt(c.state), 'city and state');
  need(/^\d{6}$/.test(txt(c.pincode)), 'PIN code');

  // ── Bank ──
  add('Bank', 'Bank', txt(c.bank_name));
  add('Bank', 'Account number', txt(c.bank_account));
  add('Bank', 'IFSC', txt(c.bank_ifsc).toUpperCase());
  add('Bank', 'Account type', labelOf(BANK_ACCOUNT_TYPES, c.bank_account_type), BANK_ACC_TYPE_CODE[txt(c.bank_account_type)]);
  add('Bank', 'Bank proof uploaded', c.bank_verified ? 'Yes' : 'No');
  need(/^\d{9,20}$/.test(txt(c.bank_account)), 'bank account number');
  need(/^[A-Z]{4}0[A-Z0-9]{6}$/.test(txt(c.bank_ifsc).toUpperCase()), 'IFSC');
  need(!!BANK_ACC_TYPE_CODE[txt(c.bank_account_type)], 'bank account type');
  if (!c.bank_verified) notes.push('No bank proof (cancelled cheque or statement) uploaded yet.');

  // ── Declaration ──
  const declared = !!c.investor_profile_completed_at;
  add('Declaration (FATCA)', 'Declared by',
    !declared ? 'Not declared' : c.investor_profile_source === 'staff' ? 'Recorded by staff on the client’s behalf' : 'The client, in the portal');
  add('Declaration (FATCA)', 'Occupation', labelOf(OCCUPATIONS, c.occupation), OCC_CODE[txt(c.occupation)]);
  add('Declaration (FATCA)', 'Annual income', labelOf(INCOME_SLABS, c.income_slab), INCOME_SLAB_CODE[txt(c.income_slab)]);
  add('Declaration (FATCA)', 'Source of wealth', labelOf(WEALTH_SOURCES, c.wealth_source), WEALTH_SOURCE_CODE[txt(c.wealth_source)]);
  add('Declaration (FATCA)', 'Politically exposed', labelOf(PEP_STATUSES, c.pep_status), PEP_CODE[txt(c.pep_status)]);
  add('Declaration (FATCA)', 'Father’s name', txt(c.father_name));
  add('Declaration (FATCA)', 'Spouse’s name', txt(c.spouse_name));
  add('Declaration (FATCA)', 'Place of birth', txt(c.birth_place));
  add('Declaration (FATCA)', 'Country of birth', c.birth_country ? countryName(c.birth_country) : '', txt(c.birth_country) || undefined);
  add('Declaration (FATCA)', 'Tax resident outside India',
    c.tax_resident_outside_india == null ? '' : c.tax_resident_outside_india
      ? `Yes — ${countryName(c.foreign_tax_country)}, tax ID ${txt(c.foreign_tax_id)}` : 'No',
    c.tax_resident_outside_india ? txt(c.foreign_tax_country) || undefined : undefined);
  need(declared, 'investor profile (occupation, income, source of wealth, political exposure, birth and tax details)');

  // ── Nomination ──
  const choice = txt(c.nomination_choice);
  if (choice === 'opt_out') {
    add('Nomination', 'Nomination', 'Opted out — no nominee');
  } else if (choice === 'nominate' || nominees.length > 0) {
    let total = 0;
    nominees.forEach((n, i) => {
      const who = `Nominee ${i + 1}`;
      const share = Number(n.share_percent) || 0;
      total += share;
      add('Nomination', who, `${txt(n.full_name)} · ${txt(n.relationship)} · ${share}%`, NOMINEE_RELATION_CODE[txt(n.relationship)]);
      add('Nomination', `${who} date of birth`, txt(n.dob));
      add('Nomination', `${who} identity document`, n.id_type ? `${labelOf(NOMINEE_ID_TYPES, n.id_type)} ${txt(n.id_number)}` : '');
      if (txt(n.guardian_name)) {
        add('Nomination', `${who} guardian`,
          `${txt(n.guardian_name)} · ${txt(n.guardian_relationship) || 'relationship not recorded'} · born ${txt(n.guardian_dob) || '—'} · PAN ${txt(n.guardian_pan) || '—'}`,
          GUARDIAN_RELATION_CODE[txt(n.guardian_relationship)]);
      }
      if (!NOMINEE_RELATION_CODE[txt(n.relationship)]) missing.push(`${who}: a relationship from the standard list`);
      if (!n.id_type || !txt(n.id_number)) missing.push(`${who}: an identity document`);
      if (!txt(n.dob)) missing.push(`${who}: date of birth`);
    });
    need(nominees.length > 0, 'nominee details');
    if (nominees.length > 3) missing.push('at most 3 nominees (the exchange limit)');
    if (nominees.length > 0 && total !== 100) missing.push(`nominee shares totalling 100% (now ${total}%)`);
  } else {
    add('Nomination', 'Nomination', 'Not recorded');
    missing.push('nomination choice (nominees, or an explicit opt-out)');
  }

  // ── Mandate ── (never blocks the account; a SIP needs it)
  const pref = txt(c.mandate_preference);
  if (!pref) {
    add('Auto-debit (mandate)', 'Preference', 'Not asked yet');
    notes.push('Auto-debit preference not recorded — needed before a SIP can start.');
  } else if (pref === 'later') {
    add('Auto-debit (mandate)', 'Preference', 'Client will set it up later');
  } else {
    add('Auto-debit (mandate)', 'Method', labelOf(MANDATE_PREFERENCES, pref), MANDATE_TYPE_CODE[pref]);
    add('Auto-debit (mandate)', 'Maximum per debit', c.mandate_max_amount ? `₹${Number(c.mandate_max_amount).toLocaleString('en-IN')}` : '');
    if (pref === 'upi') add('Auto-debit (mandate)', 'UPI ID', txt(c.mandate_upi_id));
    add('Auto-debit (mandate)', 'Debit account', [txt(c.bank_name), txt(c.bank_account), txt(c.bank_ifsc).toUpperCase()].filter(Boolean).join(' · '));
  }

  return { rows, missing, notes, ready: missing.length === 0 };
}

export type QueueBucket = 'ready' | 'needs_details' | 'opened';

/**
 * Where a mutual-fund client sits in the account queue. "Opened" wins: once
 * the account exists on the platform, gaps in our own record no longer hold
 * anything up. Otherwise a client is ready only when nothing is missing.
 */
export function queueBucket(openedAt: string | null | undefined, sheet: Pick<MfAccountSheet, 'ready'>): QueueBucket {
  if (openedAt) return 'opened';
  return sheet.ready ? 'ready' : 'needs_details';
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function sheetToCsv(sheet: MfAccountSheet): string {
  return [['Section', 'Field', 'Value', 'BSE code'], ...sheet.rows.map((r) => [r.section, r.label, r.value, r.bseCode ?? ''])]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}

export function sheetToText(sheet: MfAccountSheet): string {
  let section = '';
  const lines: string[] = [];
  for (const r of sheet.rows) {
    if (r.section !== section) { section = r.section; lines.push('', section.toUpperCase()); }
    lines.push(`${r.label}: ${r.value}${r.bseCode ? `  [BSE ${r.bseCode}]` : ''}`);
  }
  return lines.join('\n').trim();
}
