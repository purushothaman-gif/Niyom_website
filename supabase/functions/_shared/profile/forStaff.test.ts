/**
 * Staff wording of the shared validation messages.
 *
 * Pinned because an employee filling the form for a client was shown
 * "Enter your father's name" — a message about the wrong person.
 */
import { describe, expect, it } from 'vitest';
import { forStaff, validateInvestorProfile, validateMandatePreference } from './investorProfile';

describe('forStaff', () => {
  it('rewords messages to be about the client', () => {
    expect(forStaff('Select your occupation.')).toBe('Select the client’s occupation.');
    expect(forStaff('Tell us whether you are a politically exposed person.')).toBe('Say whether the client is a politically exposed person.');
    expect(forStaff('Tell us whether you pay tax in any country other than India.')).toBe('Say whether the client pays tax in any country other than India.');
    expect(forStaff('Tell us whose mobile number this is.')).toBe('Say whose mobile number this is.');
  });

  it('leaves no message from the profile or auto-debit rules addressed to "you"', () => {
    const messages: string[] = [];
    const base = { gender: 'F', occupation: 'business', income_slab: '1l_5l', wealth_source: 'salary', pep_status: 'no', birth_place: 'Pune', birth_country: 'IND', tax_resident_outside_india: true, foreign_tax_country: 'SGP', foreign_tax_id: 'T123', mobile_belongs_to: 'self', email_belongs_to: 'self' };
    for (const key of Object.keys(base)) {
      const r = validateInvestorProfile({ ...base, [key]: undefined });
      if (!r.ok) messages.push(r.error);
    }
    for (const input of [null, { preference: 'enach' }, { preference: 'upi', max_amount: 100 }]) {
      const r = validateMandatePreference(input);
      if (!r.ok) messages.push(r.error);
    }
    expect(messages.length).toBeGreaterThan(8);
    for (const m of messages) expect(forStaff(m), m).not.toMatch(/\byou(r)?\b/i);
  });
});
