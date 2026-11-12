/**
 * Investor profile → BSE codes.
 *
 * Pinned because the two files must never drift: every value onboarding can
 * store needs exactly one BSE code, and a missing declaration must come back
 * as missing — never as a default sent to the exchange in the client's name.
 */
import { describe, expect, it } from 'vitest';
import {
  BANK_ACCOUNT_TYPES, CONTACT_OWNERS, GUARDIAN_RELATIONSHIPS, INCOME_SLABS, MANDATE_PREFERENCES, NOMINEE_ID_TYPES,
  NOMINEE_RELATIONSHIPS, OCCUPATIONS, PEP_STATUSES, WEALTH_SOURCES,
} from './investorProfile';
import {
  BANK_ACC_TYPE_CODE, CONTACT_OWNER_CODE, GUARDIAN_RELATION_CODE, INCOME_SLAB_CODE, MANDATE_TYPE_CODE, NOMINEE_ID_TYPE_CODE, NOMINEE_RELATION_CODE,
  OCC_CODE, PEP_CODE, WEALTH_SOURCE_CODE, occType, toBseDeclaration, type DeclaredProfile,
} from './bseCodes';

const complete: DeclaredProfile = {
  occupation: 'private_sector_service',
  income_slab: '10l_25l',
  wealth_source: 'salary',
  pep_status: 'no',
  birth_place: 'Chennai',
  birth_country: 'IND',
  tax_resident_outside_india: false,
  mobile_belongs_to: 'self',
  email_belongs_to: 'spouse',
  investor_profile_completed_at: '2026-11-12T10:00:00Z',
};

describe('every value the form can store has one BSE code', () => {
  const cases: [string, { value: string }[], Record<string, string>][] = [
    ['occupation', OCCUPATIONS, OCC_CODE],
    ['income slab', INCOME_SLABS, INCOME_SLAB_CODE],
    ['source of wealth', WEALTH_SOURCES, WEALTH_SOURCE_CODE],
    ['politically exposed', PEP_STATUSES, PEP_CODE],
    ['contact owner', CONTACT_OWNERS, CONTACT_OWNER_CODE],
    ['bank account type', BANK_ACCOUNT_TYPES, BANK_ACC_TYPE_CODE],
  ];
  for (const [name, options, codes] of cases) {
    it(name, () => {
      for (const o of options) expect(codes[o.value], `${name}: ${o.value}`).toBeTruthy();
      // No two keys share a code, and nothing is mapped that the form cannot store.
      expect(new Set(Object.values(codes)).size).toBe(Object.keys(codes).length);
      expect(Object.keys(codes).sort()).toEqual(options.map((o) => o.value).sort());
    });
  }

  it('nominee relationship', () => {
    for (const r of NOMINEE_RELATIONSHIPS) expect(NOMINEE_RELATION_CODE[r], r).toBeTruthy();
    expect(Object.keys(NOMINEE_RELATION_CODE)).toHaveLength(22);
    expect(new Set(Object.values(NOMINEE_RELATION_CODE)).size).toBe(22);
    expect(NOMINEE_RELATION_CODE).toMatchObject({ Daughter: '3', Father: '5', Husband: '11', Son: '18', Wife: '21', Others: '22' });
  });

  it('guardian relationship and auto-debit method', () => {
    for (const g of GUARDIAN_RELATIONSHIPS) expect(GUARDIAN_RELATION_CODE[g], g).toBeTruthy();
    expect(GUARDIAN_RELATION_CODE).toEqual({ Father: '6', Mother: '13', 'Court appointed legal guardian': '23' });
    // Every method except "later", which means no mandate is created.
    for (const m of MANDATE_PREFERENCES) {
      if (m.value === 'later') expect(MANDATE_TYPE_CODE[m.value]).toBeUndefined();
      else expect(MANDATE_TYPE_CODE[m.value], m.value).toBeTruthy();
    }
  });

  it('nominee identity document, except the driving licence, which staff choose by hand', () => {
    for (const t of NOMINEE_ID_TYPES) {
      if (t.value === 'driving_licence') expect(NOMINEE_ID_TYPE_CODE[t.value]).toBeUndefined();
      else expect(NOMINEE_ID_TYPE_CODE[t.value], t.value).toBeTruthy();
    }
  });
});

describe('occType', () => {
  it('groups occupations the way the exchange does', () => {
    expect(occType('business')).toBe('B');
    expect(occType('government_service')).toBe('S');
    expect(occType('doctor')).toBe('S');
    expect(occType('retired')).toBe('O');
    expect(occType('student')).toBe('O');
  });
});

describe('toBseDeclaration', () => {
  it('translates a completed profile', () => {
    expect(toBseDeclaration(complete)).toEqual({
      occupationCode: '41',
      occupationType: 'S',
      whoseMobile: 'SE',
      whoseEmail: 'SP',
      placeOfBirth: 'Chennai',
      countryOfBirth: 'IND',
      incomeSlab: '34',
      wealthSource: '1',
      politicallyExposed: 'N',
    });
  });

  it('carries a relative of a politically exposed person as R, not as N', () => {
    expect(toBseDeclaration({ ...complete, pep_status: 'related' })?.politicallyExposed).toBe('R');
  });

  it('adds the foreign tax residency only when declared', () => {
    const r = toBseDeclaration({ ...complete, tax_resident_outside_india: true, foreign_tax_country: 'SGP', foreign_tax_id: 'S1234567A' });
    expect(r).toMatchObject({ foreignTaxCountry: 'SGP', foreignTaxId: 'S1234567A' });
    expect(toBseDeclaration(complete)).not.toHaveProperty('foreignTaxCountry');
  });

  it('returns nothing rather than a default when the declaration is missing or incomplete', () => {
    expect(toBseDeclaration(null)).toBeNull();
    expect(toBseDeclaration({ ...complete, investor_profile_completed_at: null })).toBeNull();
    expect(toBseDeclaration({ ...complete, occupation: null })).toBeNull();
    expect(toBseDeclaration({ ...complete, income_slab: 'unknown_slab' })).toBeNull();
    expect(toBseDeclaration({ ...complete, birth_country: 'India' })).toBeNull();
    expect(toBseDeclaration({ ...complete, tax_resident_outside_india: true })).toBeNull();
  });
});
