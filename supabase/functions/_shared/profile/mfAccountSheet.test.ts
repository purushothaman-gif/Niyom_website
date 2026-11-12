/**
 * MF account sheet.
 *
 * Pinned because "ready" is what staff act on: it must not say ready while a
 * declaration, a nomination choice or a usable bank account is missing, and
 * the codes printed beside each value are what gets keyed into the platform.
 */
import { describe, expect, it } from 'vitest';
import { buildMfAccountSheet, queueBucket, sheetToCsv, sheetToText, type SheetClient, type SheetNominee } from './mfAccountSheet';

const client: SheetClient = {
  client_code: 'NW0010030', full_name: 'Asha Kumar', pan_name: 'ASHA KUMAR', pan: 'ABCPK1234F', pan_verified: true,
  dob: '1988-01-15', gender: 'F', email: 'asha@example.com', phone: '9876543210',
  address: '12 Lake View Road, Adyar', city: 'Chennai', state: 'Tamil Nadu', pincode: '600020',
  bank_name: 'HDFC Bank', bank_account: '123456789012', bank_ifsc: 'HDFC0001234', bank_account_type: 'savings', bank_verified: true,
  occupation: 'private_sector_service', income_slab: '10l_25l', wealth_source: 'salary', pep_status: 'no',
  birth_place: 'Chennai', birth_country: 'IND', tax_resident_outside_india: false, father_name: 'R Kumar',
  mobile_belongs_to: 'self', email_belongs_to: 'self', nomination_choice: 'nominate',
  mandate_preference: 'upi', mandate_max_amount: 15000, mandate_upi_id: 'asha@okbank',
  investor_profile_completed_at: '2026-11-12T10:00:00Z', investor_profile_source: 'client',
};
const nominee: SheetNominee = { full_name: 'Ravi Kumar', relationship: 'Husband', dob: '1986-03-02', share_percent: 100, id_type: 'pan', id_number: 'ABCPK1234G' };

const row = (s: ReturnType<typeof buildMfAccountSheet>, label: string) => s.rows.find((r) => r.label === label);

describe('buildMfAccountSheet', () => {
  it('is ready for a complete client and prints the BSE code beside each coded value', () => {
    const s = buildMfAccountSheet(client, [nominee]);
    expect(s.missing).toEqual([]);
    expect(s.ready).toBe(true);
    expect(row(s, 'Occupation')).toMatchObject({ value: 'Private sector service', bseCode: '41' });
    expect(row(s, 'Annual income')?.bseCode).toBe('34');
    expect(row(s, 'Account type')?.bseCode).toBe('SB');
    expect(row(s, 'Mobile belongs to')?.bseCode).toBe('SE');
    expect(row(s, 'Nominee 1')).toMatchObject({ value: 'Ravi Kumar · Husband · 100%', bseCode: '11' });
    expect(row(s, 'Method')).toMatchObject({ value: 'UPI Autopay', bseCode: 'U' });
    expect(row(s, 'Country of birth')).toMatchObject({ value: 'India', bseCode: 'IND' });
  });

  it('is not ready without the declaration, and says who made it when there is one', () => {
    const s = buildMfAccountSheet({ ...client, investor_profile_completed_at: null }, [nominee]);
    expect(s.ready).toBe(false);
    expect(s.missing.join(' ')).toContain('investor profile');
    expect(row(s, 'Declared by')?.value).toBe('Not declared');
    expect(row(buildMfAccountSheet({ ...client, investor_profile_source: 'staff' }, [nominee]), 'Declared by')?.value)
      .toContain('staff');
  });

  it('treats an opt-out as a complete nomination, and silence as missing', () => {
    expect(buildMfAccountSheet({ ...client, nomination_choice: 'opt_out' }, []).ready).toBe(true);
    const silent = buildMfAccountSheet({ ...client, nomination_choice: null }, []);
    expect(silent.ready).toBe(false);
    expect(silent.missing.join(' ')).toContain('nomination choice');
  });

  it('flags nominees the exchange would reject', () => {
    const bad = buildMfAccountSheet(client, [{ ...nominee, relationship: 'Spouse', share_percent: 60, id_type: null }]);
    expect(bad.missing).toEqual(expect.arrayContaining([
      'Nominee 1: a relationship from the standard list',
      'Nominee 1: an identity document',
      'nominee shares totalling 100% (now 60%)',
    ]));
  });

  it('flags the bank and contact details an account cannot be opened without', () => {
    const s = buildMfAccountSheet({ ...client, bank_account_type: null, bank_ifsc: 'HDFC1', address: 'Adyar', gender: null }, [nominee]);
    expect(s.missing).toEqual(expect.arrayContaining(['bank account type', 'IFSC', 'full address (10+ characters)', 'gender']));
  });

  it('never blocks the account on the mandate, but notes it', () => {
    const s = buildMfAccountSheet({ ...client, mandate_preference: null }, [nominee]);
    expect(s.ready).toBe(true);
    expect(s.notes.join(' ')).toContain('Auto-debit');
    expect(row(buildMfAccountSheet({ ...client, mandate_preference: 'later' }, [nominee]), 'Preference')?.value).toContain('later');
  });
});

describe('queueBucket', () => {
  it('puts a complete, unopened client in "ready" and an incomplete one in "needs details"', () => {
    expect(queueBucket(null, buildMfAccountSheet(client, [nominee]))).toBe('ready');
    expect(queueBucket(null, buildMfAccountSheet({ ...client, investor_profile_completed_at: null }, [nominee]))).toBe('needs_details');
  });

  it('treats an opened account as done even if our own record has gaps', () => {
    expect(queueBucket('2026-11-12T10:00:00Z', buildMfAccountSheet({ ...client, gender: null }, []))).toBe('opened');
  });
});

describe('exports', () => {
  it('quotes CSV cells that contain commas', () => {
    const csv = sheetToCsv(buildMfAccountSheet(client, [nominee]));
    expect(csv.split('\n')[0]).toBe('Section,Field,Value,BSE code');
    expect(csv).toContain('Contact,Address,"12 Lake View Road, Adyar",');
  });

  it('groups the text copy by section', () => {
    const text = sheetToText(buildMfAccountSheet(client, [nominee]));
    expect(text).toContain('BANK\n');
    expect(text).toContain('Occupation: Private sector service  [BSE 41]');
  });
});
