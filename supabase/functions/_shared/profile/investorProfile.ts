/**
 * Investor profile — what a mutual-fund exchange account (BSE StAR MF UCC)
 * needs beyond name, PAN, address and bank: the FATCA declaration, who the
 * mobile and email belong to, and the nomination.
 *
 * Pure (no Deno, no I/O): the portal uses it to drive the form and the
 * save-profile edge function uses the same rules to decide what is stored.
 *
 * The option lists follow BSE's StAR MF API v2 specification (§7.4 enums,
 * document "bse-starmfv2-api_2.0.0"), so every value here has exactly one
 * exchange code. The keys stay our own; the mapping to codes lives in the
 * proxy mapper and can change without touching stored data.
 */
import { ageOn, validateNominees, type Check, type NomineeInput } from './profileRules.ts';
import { isCountryCode } from './countries.ts';

export interface Option { value: string; label: string }

export const GENDERS: Option[] = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'O', label: 'Other' },
];

export const OCCUPATIONS: Option[] = [
  { value: 'private_sector_service', label: 'Private sector service' },
  { value: 'public_sector_service', label: 'Public sector service' },
  { value: 'government_service', label: 'Government service' },
  { value: 'business', label: 'Business' },
  { value: 'professional', label: 'Professional' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'forex_dealer', label: 'Forex dealer' },
  { value: 'agriculturist', label: 'Agriculturist' },
  { value: 'retired', label: 'Retired' },
  { value: 'housewife', label: 'Homemaker' },
  { value: 'student', label: 'Student' },
  { value: 'others', label: 'Others' },
];

export const INCOME_SLABS: Option[] = [
  { value: 'below_1l', label: 'Below ₹1 lakh' },
  { value: '1l_5l', label: '₹1 – 5 lakh' },
  { value: '5l_10l', label: '₹5 – 10 lakh' },
  { value: '10l_25l', label: '₹10 – 25 lakh' },
  { value: '25l_1cr', label: '₹25 lakh – 1 crore' },
  { value: 'above_1cr', label: 'Above ₹1 crore' },
];

export const WEALTH_SOURCES: Option[] = [
  { value: 'salary', label: 'Salary' },
  { value: 'business', label: 'Business income' },
  { value: 'gift', label: 'Gift' },
  { value: 'ancestral_property', label: 'Ancestral property' },
  { value: 'rental_income', label: 'Rental income' },
  { value: 'prize_money', label: 'Prize money' },
  { value: 'royalty', label: 'Royalty' },
  { value: 'others', label: 'Others' },
];

export const PEP_STATUSES: Option[] = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes — I am a politically exposed person' },
  { value: 'related', label: 'I am related to one' },
];

/** Whose mobile / email this is — the exchange asks for both separately. */
export const CONTACT_OWNERS: Option[] = [
  { value: 'self', label: 'Mine' },
  { value: 'spouse', label: 'My spouse’s' },
  { value: 'dependent_children', label: 'My dependent child’s' },
  { value: 'dependent_siblings', label: 'My dependent sibling’s' },
  { value: 'dependent_parents', label: 'My dependent parent’s' },
  { value: 'guardian', label: 'My guardian’s' },
];

export const BANK_ACCOUNT_TYPES: Option[] = [
  { value: 'savings', label: 'Savings' },
  { value: 'current', label: 'Current' },
  { value: 'nre', label: 'NRE' },
  { value: 'nro', label: 'NRO' },
];

export const NOMINEE_ID_TYPES: Option[] = [
  { value: 'pan', label: 'PAN' },
  { value: 'aadhaar_last4', label: 'Aadhaar (last 4 digits)' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_licence', label: 'Driving licence' },
];

/**
 * The exchange's own list (§7.4.18), most common first. It has no "Spouse" or
 * "Grandchild": a husband and a wife, a grandson and a granddaughter, are
 * different codes, so the form has to ask which.
 */
export const NOMINEE_RELATIONSHIPS = [
  'Wife', 'Husband', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister',
  'Grand Son', 'Grand Daughter', 'Grand Father', 'Grand Mother',
  'Son In Law', 'Daughter In Law', 'Father In Law', 'Mother In Law',
  'Uncle', 'Aunt', 'Nephew', 'Niece', 'Friend', 'Others',
] as const;

/** Who may act for a minor nominee (§7.4.65) — the exchange accepts only these. */
export const GUARDIAN_RELATIONSHIPS = ['Father', 'Mother', 'Court appointed legal guardian'] as const;

/** Father's / spouse's name: the exchange takes 2 to 70 characters. */
export const MAX_PARENT_NAME = 70;

/** The exchange registers at most three nominees per account. */
export const MAX_MF_NOMINEES = 3;

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const has = (opts: Option[], v: unknown): v is string => typeof v === 'string' && opts.some((o) => o.value === v);
const clean = (v: unknown, max: number): string => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** True when this client's product choice calls for the investor profile. */
export function needsInvestorProfile(prefs: readonly string[] | null | undefined): boolean {
  return !!prefs?.includes('mutual_funds');
}

export interface InvestorProfileInput {
  gender?: string | null;
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
}

export interface InvestorProfile {
  gender: string;
  occupation: string;
  income_slab: string;
  wealth_source: string;
  pep_status: string;
  birth_place: string;
  birth_country: string;
  tax_resident_outside_india: boolean;
  foreign_tax_country: string | null;
  foreign_tax_id: string | null;
  father_name: string | null;
  spouse_name: string | null;
  mobile_belongs_to: string;
  email_belongs_to: string;
}

export function validateInvestorProfile(input: InvestorProfileInput): Check<InvestorProfile> {
  if (!has(GENDERS, input.gender)) return { ok: false, error: 'Select your gender.' };
  if (!has(OCCUPATIONS, input.occupation)) return { ok: false, error: 'Select your occupation.' };
  if (!has(INCOME_SLABS, input.income_slab)) return { ok: false, error: 'Select your annual income range.' };
  if (!has(WEALTH_SOURCES, input.wealth_source)) return { ok: false, error: 'Select your main source of wealth.' };
  if (!has(PEP_STATUSES, input.pep_status)) return { ok: false, error: 'Tell us whether you are a politically exposed person.' };

  const birthPlace = clean(input.birth_place, 60);
  if (birthPlace.length < 2) return { ok: false, error: 'Enter your place of birth (city or town).' };
  const birthCountry = String(input.birth_country ?? '').trim().toUpperCase();
  if (!isCountryCode(birthCountry)) return { ok: false, error: 'Select your country of birth.' };

  if (typeof input.tax_resident_outside_india !== 'boolean') {
    return { ok: false, error: 'Tell us whether you pay tax in any country other than India.' };
  }
  let foreignCountry: string | null = null;
  let foreignId: string | null = null;
  if (input.tax_resident_outside_india) {
    foreignCountry = String(input.foreign_tax_country ?? '').trim().toUpperCase();
    foreignId = clean(input.foreign_tax_id, 40);
    if (!isCountryCode(foreignCountry) || foreignCountry === 'IND') {
      return { ok: false, error: 'Select the other country where you are a tax resident.' };
    }
    if (foreignId.length < 3) return { ok: false, error: 'Enter your tax identification number for that country.' };
  }

  // Both optional: the exchange marks them conditional and has registered
  // accounts without either. Kept when given (2+ characters), never demanded.
  const father = clean(input.father_name, MAX_PARENT_NAME);
  const spouse = clean(input.spouse_name, MAX_PARENT_NAME);

  if (!has(CONTACT_OWNERS, input.mobile_belongs_to)) return { ok: false, error: 'Tell us whose mobile number this is.' };
  if (!has(CONTACT_OWNERS, input.email_belongs_to)) return { ok: false, error: 'Tell us whose email address this is.' };

  return {
    ok: true,
    value: {
      gender: input.gender,
      occupation: input.occupation,
      income_slab: input.income_slab,
      wealth_source: input.wealth_source,
      pep_status: input.pep_status,
      birth_place: birthPlace,
      birth_country: birthCountry,
      tax_resident_outside_india: input.tax_resident_outside_india,
      foreign_tax_country: foreignCountry,
      foreign_tax_id: foreignId,
      father_name: father.length >= 2 ? father : null,
      spouse_name: spouse.length >= 2 ? spouse : null,
      mobile_belongs_to: input.mobile_belongs_to,
      email_belongs_to: input.email_belongs_to,
    },
  };
}

export interface MfNomineeInput extends NomineeInput {
  id_type?: string | null;
  id_number?: string | null;
  guardian_dob?: string | null;
  guardian_pan?: string | null;
  guardian_relationship?: string | null;
}

export type NominationInput =
  | { choice: 'opt_out' }
  | { choice: 'nominate'; nominees: MfNomineeInput[] };

export type Nomination =
  | { choice: 'opt_out'; nominees: [] }
  | { choice: 'nominate'; nominees: MfNomineeInput[] };

/**
 * A nomination for an exchange account: an explicit choice, and when
 * nominating, at most three nominees with whole-number shares totalling 100,
 * each with a date of birth and an identity document, and a guardian with a
 * PAN and date of birth for a minor.
 */
export function validateNomination(input: NominationInput | null | undefined, today = new Date()): Check<Nomination> {
  if (!input || (input.choice !== 'opt_out' && input.choice !== 'nominate')) {
    return { ok: false, error: 'Choose whether to add a nominee or opt out of nomination.' };
  }
  if (input.choice === 'opt_out') return { ok: true, value: { choice: 'opt_out', nominees: [] } };

  const list = Array.isArray(input.nominees) ? input.nominees : [];
  if (list.length === 0) return { ok: false, error: 'Add at least one nominee, or opt out of nomination.' };
  if (list.length > MAX_MF_NOMINEES) return { ok: false, error: `You can add up to ${MAX_MF_NOMINEES} nominees.` };

  // Names, relationship, share total and the guardian's name for a minor.
  const base = validateNominees(list, today);
  if (!base.ok) return base;

  const out: MfNomineeInput[] = [];
  for (const [i, n] of list.entries()) {
    const label = `Nominee ${i + 1}`;
    const core = base.value[i];
    if (!(NOMINEE_RELATIONSHIPS as readonly string[]).includes(core.relationship)) {
      return { ok: false, error: `${label}: choose the relationship from the list.` };
    }
    if (!Number.isInteger(core.share_percent)) return { ok: false, error: `${label}: share must be a whole number.` };
    if (!core.dob) return { ok: false, error: `${label}: enter the date of birth.` };

    if (!has(NOMINEE_ID_TYPES, n.id_type)) return { ok: false, error: `${label}: choose an identity document.` };
    const rawId = String(n.id_number ?? '').trim().toUpperCase().replace(/\s+/g, '');
    let idNumber = rawId;
    if (n.id_type === 'pan') {
      if (!PAN.test(rawId)) return { ok: false, error: `${label}: enter a valid PAN.` };
    } else if (n.id_type === 'aadhaar_last4') {
      // Never the full number — only the last four digits are kept.
      if (!/^\d{4}$/.test(rawId)) return { ok: false, error: `${label}: enter only the last 4 digits of the Aadhaar.` };
    } else {
      if (!/^[A-Z0-9-]{5,20}$/.test(rawId)) return { ok: false, error: `${label}: enter a valid document number.` };
      idNumber = rawId;
    }

    let guardianDob: string | null = null;
    let guardianPan: string | null = null;
    let guardianRel: string | null = null;
    const age = ageOn(core.dob, today);
    if (age !== null && age < 18) {
      guardianDob = String(n.guardian_dob ?? '').trim();
      const gAge = guardianDob ? ageOn(guardianDob, today) : null;
      if (gAge === null || gAge < 18 || gAge > 120) return { ok: false, error: `${label}: enter the guardian's date of birth (an adult).` };
      guardianPan = String(n.guardian_pan ?? '').trim().toUpperCase();
      if (!PAN.test(guardianPan)) return { ok: false, error: `${label}: enter the guardian's PAN.` };
      guardianRel = String(n.guardian_relationship ?? '').trim();
      if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(guardianRel)) {
        return { ok: false, error: `${label}: choose who the guardian is — father, mother or a court-appointed guardian.` };
      }
    }

    out.push({
      ...core,
      id_type: n.id_type,
      id_number: idNumber,
      guardian_dob: guardianDob,
      guardian_pan: guardianPan,
      guardian_relationship: guardianRel,
    });
  }
  return { ok: true, value: { choice: 'nominate', nominees: out } };
}

/**
 * How the client wants a SIP's bank mandate authorised. Both the platform in
 * use today and BSE StAR MF ask the same things: the method, the most that
 * may be debited at a time and, for UPI, the UPI ID. The bank account is the
 * client's primary one. 'later' is a real answer — asked, and not yet.
 */
export const MANDATE_PREFERENCES: Option[] = [
  { value: 'enach', label: 'e-NACH (net banking or debit card)' },
  { value: 'upi', label: 'UPI Autopay' },
  { value: 'later', label: 'Set up later' },
];

/** A ceiling on the per-debit limit, to catch a slipped decimal — not a regulatory limit. */
export const MAX_MANDATE_AMOUNT = 10_000_000;

export interface MandatePreferenceInput {
  preference?: string | null;
  max_amount?: number | string | null;
  upi_id?: string | null;
}

export interface MandatePreference {
  preference: 'later' | 'enach' | 'upi';
  max_amount: number | null;
  upi_id: string | null;
}

export function validateMandatePreference(input: MandatePreferenceInput | null | undefined): Check<MandatePreference> {
  const pref = input?.preference;
  if (pref !== 'later' && pref !== 'enach' && pref !== 'upi') {
    return { ok: false, error: 'Choose how you would like to set up auto-debit for SIPs, or choose to set it up later.' };
  }
  if (pref === 'later') return { ok: true, value: { preference: 'later', max_amount: null, upi_id: null } };

  const amount = Number(input?.max_amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter the maximum amount that may be debited at a time.' };
  if (!Number.isInteger(amount)) return { ok: false, error: 'Enter the maximum debit amount in whole rupees.' };
  if (amount > MAX_MANDATE_AMOUNT) return { ok: false, error: 'That maximum debit amount looks too high — please check it.' };

  let upi: string | null = null;
  if (pref === 'upi') {
    upi = String(input?.upi_id ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$/.test(upi)) return { ok: false, error: 'Enter a valid UPI ID (for example name@bank).' };
  }
  return { ok: true, value: { preference: pref, max_amount: amount, upi_id: upi } };
}

/** Details-step rules that only apply when an exchange account is wanted. */
export function validateMfDetails(d: { dob?: string | null; address?: string | null; bank_ifsc?: string | null; bank_account?: string | null; bank_account_type?: string | null }, today = new Date()): Check<true> {
  const age = d.dob ? ageOn(d.dob, today) : null;
  if (age === null || age < 0 || age > 120) return { ok: false, error: 'Enter your date of birth.' };
  if (age < 18) return { ok: false, error: 'You must be 18 or older to open an investing account here.' };
  if (clean(d.address, 300).length < 10) return { ok: false, error: 'Enter your full address — at least 10 characters.' };
  if (!IFSC.test(String(d.bank_ifsc ?? '').trim().toUpperCase())) return { ok: false, error: 'Enter a valid 11-character IFSC (e.g. HDFC0001234).' };
  if (!/^\d{9,20}$/.test(String(d.bank_account ?? '').trim())) return { ok: false, error: 'Enter your bank account number (9 to 20 digits).' };
  if (!has(BANK_ACCOUNT_TYPES, d.bank_account_type)) return { ok: false, error: 'Select your bank account type.' };
  return { ok: true, value: true };
}

/**
 * The shared rules word their messages for the investor ("Select your
 * occupation"). When an employee is filling the form for a client, the same
 * message is reworded to be about the client.
 */
export function forStaff(message: string): string {
  return message
    .replace(/Tell us whether you are/g, 'Say whether the client is')
    .replace(/Tell us whether you pay/g, 'Say whether the client pays')
    .replace(/Tell us whose/g, 'Say whose')
    .replace(/where you are a tax resident/g, 'where the client is a tax resident')
    .replace(/how you would like/g, 'how the client would like')
    .replace(/You must be/g, 'The client must be')
    .replace(/\byour\b/g, 'the client’s')
    .replace(/\bYour\b/g, 'The client’s');
}

export const labelOf = (opts: Option[], value: string | null | undefined): string =>
  opts.find((o) => o.value === value)?.label ?? '—';
