/**
 * Investor-profile rules.
 *
 * Pinned because what passes here is stored as the investor's own regulatory
 * declaration and later sent to the exchange in their name: a half-filled
 * profile must not read as complete, an Aadhaar must never be kept in full,
 * and a minor nominee must not get through without a guardian.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_MF_NOMINEES,
  needsInvestorProfile,
  kycDetailsOnRecord,
  validateInvestorProfile,
  validateKycDetails,
  validateMandatePreference,
  validateMfDetails,
  validateNomination,
  type InvestorProfileInput,
  type MfNomineeInput,
} from './investorProfile';

const TODAY = new Date('2026-11-12T00:00:00Z');

const profile: InvestorProfileInput = {
  gender: 'F',
  occupation: 'professional',
  income_slab: '10l_25l',
  wealth_source: 'salary',
  pep_status: 'no',
  birth_place: '  Chennai ',
  birth_country: 'ind',
  tax_resident_outside_india: false,
  father_name: 'R Kumar',
  spouse_name: '',
  mobile_belongs_to: 'self',
  email_belongs_to: 'spouse',
};

const adult: MfNomineeInput = {
  full_name: 'Asha Kumar',
  relationship: 'Wife',
  dob: '1990-04-02',
  share_percent: 100,
  id_type: 'pan',
  id_number: 'abcde1234f',
};

describe('needsInvestorProfile', () => {
  it('applies only when mutual funds are chosen', () => {
    expect(needsInvestorProfile(['bonds', 'mutual_funds'])).toBe(true);
    expect(needsInvestorProfile(['bonds', 'unlisted_shares'])).toBe(false);
    expect(needsInvestorProfile([])).toBe(false);
    expect(needsInvestorProfile(null)).toBe(false);
  });
});

describe('validateInvestorProfile', () => {
  it('accepts a complete profile and tidies free text', () => {
    const r = validateInvestorProfile(profile);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.birth_place).toBe('Chennai');
    expect(r.value.birth_country).toBe('IND');
    expect(r.value.spouse_name).toBeNull();
    expect(r.value.foreign_tax_country).toBeNull();
  });

  it('rejects each missing declaration rather than assuming a default', () => {
    for (const key of ['gender', 'occupation', 'income_slab', 'wealth_source', 'pep_status', 'mobile_belongs_to', 'email_belongs_to'] as const) {
      expect(validateInvestorProfile({ ...profile, [key]: undefined }).ok, key).toBe(false);
      expect(validateInvestorProfile({ ...profile, [key]: 'not-a-real-option' }).ok, key).toBe(false);
    }
    expect(validateInvestorProfile({ ...profile, birth_place: ' ' }).ok).toBe(false);
    expect(validateInvestorProfile({ ...profile, tax_resident_outside_india: undefined }).ok).toBe(false);
  });

  it('treats the father and spouse names as optional, keeping whichever is given', () => {
    const neither = validateInvestorProfile({ ...profile, father_name: '', spouse_name: '' });
    expect(neither.ok && neither.value.father_name).toBeNull();
    expect(neither.ok && neither.value.spouse_name).toBeNull();
    const spouseOnly = validateInvestorProfile({ ...profile, father_name: '', spouse_name: 'A Kumar' });
    expect(spouseOnly.ok && spouseOnly.value.spouse_name).toBe('A Kumar');
    // A single stray character is not a name — dropped rather than stored.
    const stray = validateInvestorProfile({ ...profile, father_name: 'x', spouse_name: '' });
    expect(stray.ok && stray.value.father_name).toBeNull();
  });

  it('asks for the country and tax number when tax is paid abroad', () => {
    const abroad = { ...profile, tax_resident_outside_india: true };
    expect(validateInvestorProfile(abroad).ok).toBe(false);
    expect(validateInvestorProfile({ ...abroad, foreign_tax_country: 'SGP' }).ok).toBe(false);
    // "abroad" cannot be India, and a country must be a real code, not free text.
    expect(validateInvestorProfile({ ...abroad, foreign_tax_country: 'IND', foreign_tax_id: 'S1234567A' }).ok).toBe(false);
    expect(validateInvestorProfile({ ...abroad, foreign_tax_country: 'Singapore', foreign_tax_id: 'S1234567A' }).ok).toBe(false);
    const r = validateInvestorProfile({ ...abroad, foreign_tax_country: 'SGP', foreign_tax_id: 'S1234567A' });
    expect(r.ok && r.value.foreign_tax_id).toBe('S1234567A');
  });

  it('takes the country of birth as a code and the exchange occupations', () => {
    expect(validateInvestorProfile({ ...profile, birth_country: 'India' }).ok).toBe(false);
    expect(validateInvestorProfile({ ...profile, occupation: 'doctor' }).ok).toBe(true);
    expect(validateInvestorProfile({ ...profile, occupation: 'forex_dealer' }).ok).toBe(true);
  });

  it('keeps a father or spouse name within the exchange limit', () => {
    const r = validateInvestorProfile({ ...profile, father_name: 'A'.repeat(90) });
    expect(r.ok && r.value.father_name?.length).toBe(70);
  });
});

describe('validateNomination', () => {
  it('requires an explicit choice', () => {
    expect(validateNomination(null, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'maybe' } as never, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'opt_out' }, TODAY)).toEqual({ ok: true, value: { choice: 'opt_out', nominees: [] } });
  });

  it('accepts one adult nominee and normalises the PAN', () => {
    const r = validateNomination({ choice: 'nominate', nominees: [adult] }, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.nominees[0]).toMatchObject({ id_type: 'pan', id_number: 'ABCDE1234F', guardian_pan: null });
  });

  it('will not treat "nominate" with nobody listed as a nomination', () => {
    expect(validateNomination({ choice: 'nominate', nominees: [] }, TODAY).ok).toBe(false);
  });

  it('enforces the exchange limits: three nominees, whole shares, total 100', () => {
    const four = Array.from({ length: MAX_MF_NOMINEES + 1 }, () => ({ ...adult, share_percent: 25 }));
    expect(validateNomination({ choice: 'nominate', nominees: four }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, share_percent: 33.5 }, { ...adult, share_percent: 66.5 }] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, share_percent: 60 }] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, share_percent: 60 }, { ...adult, share_percent: 40 }] }, TODAY).ok).toBe(true);
  });

  it('only takes a relationship the exchange has a code for', () => {
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, relationship: 'Spouse' }] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, relationship: 'Grandchild' }] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, relationship: 'Grand Daughter' }] }, TODAY).ok).toBe(true);
  });

  it('needs a date of birth and an identity document', () => {
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, dob: null }] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, id_type: undefined }] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...adult, id_number: 'ABCDE12345' }] }, TODAY).ok).toBe(false);
  });

  it('never accepts a full Aadhaar number', () => {
    const aadhaar = { ...adult, id_type: 'aadhaar_last4' };
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...aadhaar, id_number: '123412341234' }] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...aadhaar, id_number: '1234 5678 9012' }] }, TODAY).ok).toBe(false);
    const r = validateNomination({ choice: 'nominate', nominees: [{ ...aadhaar, id_number: '9012' }] }, TODAY);
    expect(r.ok && r.value.nominees[0].id_number).toBe('9012');
  });

  it('needs a guardian with a PAN, date of birth and relationship for a minor', () => {
    const minor: MfNomineeInput = { ...adult, relationship: 'Son', dob: '2015-06-01', guardian_name: 'Asha Kumar' };
    expect(validateNomination({ choice: 'nominate', nominees: [minor] }, TODAY).ok).toBe(false);
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...minor, guardian_dob: '1990-04-02', guardian_pan: 'ABCDE1234F' }] }, TODAY).ok).toBe(false);
    // The guardian must be an adult.
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...minor, guardian_dob: '2012-01-01', guardian_pan: 'ABCDE1234F', guardian_relationship: 'Mother' }] }, TODAY).ok).toBe(false);
    // Only the guardians the exchange recognises.
    expect(validateNomination({ choice: 'nominate', nominees: [{ ...minor, guardian_dob: '1990-04-02', guardian_pan: 'ABCDE1234F', guardian_relationship: 'Aunt' }] }, TODAY).ok).toBe(false);
    const r = validateNomination({ choice: 'nominate', nominees: [{ ...minor, guardian_dob: '1990-04-02', guardian_pan: 'abcde1234f', guardian_relationship: 'Mother' }] }, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.nominees[0]).toMatchObject({ guardian_pan: 'ABCDE1234F', guardian_relationship: 'Mother' });
  });
});

describe('validateMandatePreference', () => {
  it('needs an answer, and "later" is one', () => {
    expect(validateMandatePreference(null).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'cheque' }).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'later', max_amount: 5000, upi_id: 'x@y' }))
      .toEqual({ ok: true, value: { preference: 'later', max_amount: null, upi_id: null } });
  });

  it('needs a whole-rupee limit for e-NACH and ignores any UPI ID', () => {
    expect(validateMandatePreference({ preference: 'enach' }).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'enach', max_amount: 0 }).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'enach', max_amount: 2500.5 }).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'enach', max_amount: 99_000_000_000 }).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'enach', max_amount: '25000', upi_id: 'asha@okbank' }))
      .toEqual({ ok: true, value: { preference: 'enach', max_amount: 25000, upi_id: null } });
  });

  it('needs a UPI ID for UPI Autopay', () => {
    expect(validateMandatePreference({ preference: 'upi', max_amount: 15000 }).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'upi', max_amount: 15000, upi_id: 'not-a-upi-id' }).ok).toBe(false);
    expect(validateMandatePreference({ preference: 'upi', max_amount: 15000, upi_id: ' Asha.K@OkBank ' }))
      .toEqual({ ok: true, value: { preference: 'upi', max_amount: 15000, upi_id: 'asha.k@okbank' } });
  });
});

describe('validateMfDetails', () => {
  const ok = { dob: '1988-01-15', address: '12 Lake View Road, Adyar', bank_ifsc: 'HDFC0001234', bank_account: '123456789012', bank_account_type: 'savings' };

  it('accepts complete details', () => {
    expect(validateMfDetails(ok, TODAY).ok).toBe(true);
  });

  it('rejects a missing or under-18 date of birth, a short address, a bad IFSC or account, and no account type', () => {
    expect(validateMfDetails({ ...ok, dob: '' }, TODAY).ok).toBe(false);
    expect(validateMfDetails({ ...ok, dob: '2012-01-01' }, TODAY).ok).toBe(false);
    expect(validateMfDetails({ ...ok, address: 'Adyar' }, TODAY).ok).toBe(false);
    expect(validateMfDetails({ ...ok, bank_ifsc: 'HDFC1001234' }, TODAY).ok).toBe(false);
    expect(validateMfDetails({ ...ok, bank_account: '12345' }, TODAY).ok).toBe(false);
    expect(validateMfDetails({ ...ok, bank_account_type: '' }, TODAY).ok).toBe(false);
  });
});

describe('validateKycDetails', () => {
  const ok = {
    dob: '1988-01-15', address: '12 Lake View Road, Adyar', city: 'Chennai', state: 'Tamil Nadu', pincode: '600020',
    bank_name: 'HDFC Bank', bank_account: '123456789012', bank_ifsc: 'hdfc0001234', bank_account_type: 'savings',
  };

  it('accepts a complete step with no demat account and tidies it', () => {
    const r = validateKycDetails(ok, {}, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ bank_ifsc: 'HDFC0001234', demat_account: '', dp_name: '', depository: '' });
    expect(kycDetailsOnRecord(ok, TODAY)).toBe(true);
  });

  it('needs every address and bank field', () => {
    for (const key of ['dob', 'address', 'city', 'state', 'pincode', 'bank_name', 'bank_account', 'bank_ifsc', 'bank_account_type'] as const) {
      expect(validateKycDetails({ ...ok, [key]: '' }, {}, TODAY).ok, key).toBe(false);
    }
    expect(validateKycDetails({ ...ok, pincode: '012345' }, {}, TODAY).ok).toBe(false);
    expect(kycDetailsOnRecord({ ...ok, bank_account_type: null }, TODAY)).toBe(false);
    expect(kycDetailsOnRecord(null, TODAY)).toBe(false);
  });

  it('asks for demat details only when a demat product is chosen', () => {
    expect(validateKycDetails(ok, { dematRequired: true }, TODAY).ok).toBe(false);
    expect(validateKycDetails({ ...ok, demat_account: '1234567890123456' }, { dematRequired: true }, TODAY).ok).toBe(false);
    const cdsl = validateKycDetails({ ...ok, demat_account: '1234567890123456', dp_name: 'Zerodha' }, { dematRequired: true }, TODAY);
    expect(cdsl.ok && cdsl.value.depository).toBe('CDSL');
    const nsdl = validateKycDetails({ ...ok, demat_account: 'in30021412345678', dp_name: 'HDFC Securities' }, {}, TODAY);
    expect(nsdl.ok && nsdl.value).toMatchObject({ demat_account: 'IN30021412345678', depository: 'NSDL' });
  });

  it('rejects a demat number of the wrong length, or one without its DP', () => {
    expect(validateKycDetails({ ...ok, demat_account: '12345', dp_name: 'Zerodha' }, {}, TODAY).ok).toBe(false);
    expect(validateKycDetails({ ...ok, demat_account: '1234567890123456' }, {}, TODAY).ok).toBe(false);
  });
});
