/**
 * add_ucc payload — the investor's own declaration.
 *
 * Pinned because these fields go to the exchange as the investor's
 * declaration: what the client said must arrive unchanged, the defaults that
 * registered live before must not move for callers that send nothing, and a
 * nominee must never inherit "this is my spouse's mobile" from the holder.
 */
import { describe, expect, it } from 'vitest';
import { toAddUcc, type AppUccRequest } from './mappers.js';

const base: AppUccRequest = {
  clientCode: 'NW0010030',
  pan: 'abcpe1234f',
  firstName: 'Asha',
  lastName: 'Kumar',
  dob: '1988-01-15',
  gender: 'F',
  email: 'asha@example.com',
  mobile: '9876543210',
  address: { line1: '12 Lake View Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600020' },
  bank: { accountNumber: '123456789012', ifsc: 'hdfc0001234' },
};

const fatcaOf = (p: ReturnType<typeof toAddUcc>) => p.fatca[0];
const holderOf = (p: ReturnType<typeof toAddUcc>) => p.holder[0];

describe('toAddUcc defaults (unchanged for callers that send no declaration)', () => {
  it('keeps the values that registered live', () => {
    const p = toAddUcc(base, '12345');
    expect(holderOf(p).occ_code).toBe('02');
    expect(holderOf(p).contact[0]).toMatchObject({ whose_contact_number: 'SE', whose_email_address: 'SE' });
    expect(fatcaOf(p)).toMatchObject({
      occ_type: 'B', wealth_source: '1', income_slab: '31', politically_exposed: 'N',
      place_of_birth: 'Chennai', country_of_birth: 'IND',
    });
    expect(fatcaOf(p).tax_residency).toEqual([{ country: 'IND', tax_id_no: 'ABCPE1234F', tax_id_type: 'C' }]);
    expect(p.bank_account[0].bank_acc_type).toBe('SB');
  });

  it('still accepts the boolean form of politically exposed', () => {
    expect(fatcaOf(toAddUcc({ ...base, fatca: { politicallyExposed: true } }, 'm')).politically_exposed).toBe('Y');
    expect(fatcaOf(toAddUcc({ ...base, fatca: { politicallyExposed: false } }, 'm')).politically_exposed).toBe('N');
  });
});

describe('toAddUcc with the investor declaration', () => {
  const declared: AppUccRequest = {
    ...base,
    occupationCode: '41',
    occupationType: 'S',
    whoseMobile: 'SP',
    whoseEmail: 'SE',
    bank: { ...base.bank, accountType: 'CB' },
    fatca: {
      placeOfBirth: 'Madurai', countryOfBirth: 'IND', incomeSlab: '34', wealthSource: '2',
      politicallyExposed: 'R', fatherName: 'R Kumar', foreignTaxCountry: 'SGP', foreignTaxId: 'S1234567A',
    },
  };

  it('sends what the investor declared', () => {
    const p = toAddUcc(declared, 'm');
    expect(holderOf(p).occ_code).toBe('41');
    expect(holderOf(p).contact[0]).toMatchObject({ whose_contact_number: 'SP', whose_email_address: 'SE' });
    expect(fatcaOf(p)).toMatchObject({
      occ_code: '41', occ_type: 'S', wealth_source: '2', income_slab: '34', politically_exposed: 'R',
      place_of_birth: 'Madurai', father_name: 'R Kumar',
    });
    expect(p.bank_account[0].bank_acc_type).toBe('CB');
  });

  it('adds the foreign tax residency after the Indian one', () => {
    expect(fatcaOf(toAddUcc(declared, 'm')).tax_residency).toEqual([
      { country: 'IND', tax_id_no: 'ABCPE1234F', tax_id_type: 'C' },
      { country: 'SGP', tax_id_no: 'S1234567A', tax_id_type: 'T' },
    ]);
  });

  it('does not pass the holder\'s "whose mobile" answer on to a nominee', () => {
    const p = toAddUcc({
      ...declared,
      nominees: [{ firstName: 'Ravi', relation: '18', percent: 100, identifierType: 'pan', identifierNumber: 'ABCPE1234G' }],
    }, 'm');
    const nominee = (holderOf(p) as { nomination: { contact: Record<string, string> }[] }).nomination[0];
    expect(nominee.contact).toMatchObject({ whose_contact_number: 'SE', whose_email_address: 'SE' });
    expect(holderOf(p).contact[0].whose_contact_number).toBe('SP');
  });
});
