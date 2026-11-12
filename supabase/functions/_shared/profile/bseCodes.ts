/**
 * Investor profile → BSE StAR MF codes.
 *
 * Onboarding stores the investor's declaration under our own keys
 * (investorProfile.ts). This is the one place those keys become the codes
 * BSE's API v2 expects — every table below is copied from §7.4 of BSE's
 * specification ("bse-starmfv2-api_2.0.0"), with the section noted.
 *
 * Pure, and exhaustively tested against the option lists: a key the form can
 * store but that has no code here would otherwise surface as a rejected UCC,
 * or worse, as a silently defaulted declaration.
 */

/** §7.4.8 occ_code */
export const OCC_CODE: Record<string, string> = {
  business: '01',
  professional: '03',
  agriculturist: '04',
  retired: '05',
  housewife: '06',
  student: '07',
  others: '08',
  doctor: '09',
  private_sector_service: '41',
  public_sector_service: '42',
  forex_dealer: '43',
  government_service: '44',
};

/** §7.4.23 occ_type — B Business, S Service, O Others. */
export function occType(occupation: string): 'B' | 'S' | 'O' {
  if (occupation === 'business' || occupation === 'forex_dealer') return 'B';
  if (['private_sector_service', 'public_sector_service', 'government_service', 'professional', 'doctor'].includes(occupation)) return 'S';
  return 'O';
}

/** §7.4.27 income_slab */
export const INCOME_SLAB_CODE: Record<string, string> = {
  below_1l: '31', '1l_5l': '32', '5l_10l': '33', '10l_25l': '34', '25l_1cr': '35', above_1cr: '36',
};

/** §7.4.26 wealth_source */
export const WEALTH_SOURCE_CODE: Record<string, string> = {
  salary: '1', business: '2', gift: '3', ancestral_property: '4',
  rental_income: '5', prize_money: '6', royalty: '7', others: '8',
};

/** §7.4.28 politically_exposed */
export const PEP_CODE: Record<string, 'Y' | 'N' | 'R'> = { no: 'N', yes: 'Y', related: 'R' };

/** §7.4.16 whose_contact_number / whose_email_address */
export const CONTACT_OWNER_CODE: Record<string, string> = {
  self: 'SE', spouse: 'SP', dependent_children: 'DC', dependent_siblings: 'DS', dependent_parents: 'DP', guardian: 'GD',
};

/** §7.4.12 bank_acc_type */
export const BANK_ACC_TYPE_CODE: Record<string, string> = { savings: 'SB', current: 'CB', nre: 'NE', nro: 'NO' };

/** §7.4.46 mandate_type — N e-NACH, U UPI Autopay. ('later' has no mandate.) */
export const MANDATE_TYPE_CODE: Record<string, 'N' | 'U'> = { enach: 'N', upi: 'U' };

/** §7.4.65 guardian_relation — keyed by the label the form stores. */
export const GUARDIAN_RELATION_CODE: Record<string, string> = {
  'Father': '6', 'Mother': '13', 'Court appointed legal guardian': '23',
};

/** §7.4.18 nomination_relation — keyed by the label the form stores. */
export const NOMINEE_RELATION_CODE: Record<string, string> = {
  'Aunt': '1', 'Brother': '2', 'Daughter': '3', 'Daughter In Law': '4', 'Father': '5', 'Father In Law': '6',
  'Grand Daughter': '7', 'Grand Son': '8', 'Grand Father': '9', 'Grand Mother': '10', 'Husband': '11',
  'Mother': '12', 'Mother In Law': '13', 'Nephew': '14', 'Niece': '15', 'Friend': '16', 'Sister': '17',
  'Son': '18', 'Son In Law': '19', 'Uncle': '20', 'Wife': '21', 'Others': '22',
};

/**
 * Nominee identity document → BSE identifier_type (§7.3.10, §7.4.20).
 * A driving licence is allowed by the specification, but its identifier key is
 * not stated unambiguously there, so it is deliberately left unmapped: staff
 * pick the document type by hand rather than risk a rejected registration.
 */
export const NOMINEE_ID_TYPE_CODE: Record<string, 'pan' | 'aadhaar' | 'passport'> = {
  pan: 'pan', aadhaar_last4: 'aadhaar', passport: 'passport',
};

/** The columns of nw_clients this module reads. */
export interface DeclaredProfile {
  occupation?: string | null;
  income_slab?: string | null;
  wealth_source?: string | null;
  pep_status?: string | null;
  birth_place?: string | null;
  birth_country?: string | null;
  tax_resident_outside_india?: boolean | null;
  foreign_tax_country?: string | null;
  foreign_tax_id?: string | null;
  mobile_belongs_to?: string | null;
  email_belongs_to?: string | null;
  investor_profile_completed_at?: string | null;
}

/** The investor's declaration, in the codes BSE's add_ucc takes. */
export interface BseDeclaration {
  occupationCode: string;
  occupationType: 'B' | 'S' | 'O';
  whoseMobile: string;
  whoseEmail: string;
  placeOfBirth: string;
  countryOfBirth: string;
  incomeSlab: string;
  wealthSource: string;
  politicallyExposed: 'Y' | 'N' | 'R';
  /** Present only when the investor declared tax residency outside India. */
  foreignTaxCountry?: string;
  foreignTaxId?: string;
}

/**
 * The client's declaration as BSE codes, or null when it cannot be sent as the
 * client's own: the profile was never completed, or a stored value has no code
 * (which would mean the lists and this file have drifted). Never fills a gap
 * with a default — a missing declaration must read as missing.
 */
export function toBseDeclaration(c: DeclaredProfile | null | undefined): BseDeclaration | null {
  if (!c?.investor_profile_completed_at) return null;
  const occupationCode = OCC_CODE[c.occupation ?? ''];
  const incomeSlab = INCOME_SLAB_CODE[c.income_slab ?? ''];
  const wealthSource = WEALTH_SOURCE_CODE[c.wealth_source ?? ''];
  const politicallyExposed = PEP_CODE[c.pep_status ?? ''];
  const whoseMobile = CONTACT_OWNER_CODE[c.mobile_belongs_to ?? ''];
  const whoseEmail = CONTACT_OWNER_CODE[c.email_belongs_to ?? ''];
  const placeOfBirth = (c.birth_place ?? '').trim();
  const countryOfBirth = (c.birth_country ?? '').trim().toUpperCase();
  if (!occupationCode || !incomeSlab || !wealthSource || !politicallyExposed || !whoseMobile || !whoseEmail) return null;
  if (placeOfBirth.length < 2 || !/^[A-Z]{3}$/.test(countryOfBirth)) return null;

  const out: BseDeclaration = {
    occupationCode,
    occupationType: occType(c.occupation ?? ''),
    whoseMobile,
    whoseEmail,
    placeOfBirth,
    countryOfBirth,
    incomeSlab,
    wealthSource,
    politicallyExposed,
  };
  if (c.tax_resident_outside_india) {
    const country = (c.foreign_tax_country ?? '').trim().toUpperCase();
    const id = (c.foreign_tax_id ?? '').trim();
    if (!/^[A-Z]{3}$/.test(country) || !id) return null;
    out.foreignTaxCountry = country;
    out.foreignTaxId = id;
  }
  return out;
}
