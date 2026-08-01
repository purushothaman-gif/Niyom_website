/**
 * Consent rules.
 *
 * These matter beyond correctness: under the DPDP Act, "what was this client
 * shown when they agreed?" has to stay answerable, and that only holds if the
 * required set is stable and the policy version moves whenever the wording
 * does. A silent change to either is the failure these guard against.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSENT,
  CONSENT_COPY,
  CONSENT_POLICY_VERSION,
  IMPORT_CONSENTS,
  hasRequiredConsents,
  requiredConsents,
} from './consent';

describe('consent requirements', () => {
  it('cannot proceed with none granted', () => {
    expect(hasRequiredConsents([])).toBe(false);
  });

  it('cannot proceed with only some of the required set', () => {
    expect(hasRequiredConsents([CONSENT.casRequest])).toBe(false);
    expect(hasRequiredConsents([CONSENT.casRequest, CONSENT.portfolioImport])).toBe(false);
  });

  it('proceeds once every required consent is granted', () => {
    expect(hasRequiredConsents(requiredConsents())).toBe(true);
  });

  it('does not require the optional ones', () => {
    // A client must be able to import a statement by hand while refusing us any
    // access to their email — that refusal is the whole point of splitting them.
    expect(requiredConsents()).not.toContain(CONSENT.emailRead);
    expect(requiredConsents()).not.toContain(CONSENT.arnMigration);
  });

  it('is unaffected by extra consents being granted', () => {
    expect(hasRequiredConsents([...requiredConsents(), CONSENT.emailRead])).toBe(true);
  });

  it('asks for exactly the three import consents, and email is not one of them', () => {
    // Email access belongs to a later, separate flow. If it ever appears in the
    // import wizard's list it must be a deliberate change, not a drift.
    expect(IMPORT_CONSENTS).toEqual([
      CONSENT.casRequest,
      CONSENT.portfolioImport,
      CONSENT.tempStorage,
    ]);
  });
});

describe('consent copy', () => {
  it('has wording for every consent type', () => {
    for (const type of Object.values(CONSENT)) {
      expect(CONSENT_COPY[type]?.label?.length).toBeGreaterThan(0);
      expect(CONSENT_COPY[type]?.detail?.length).toBeGreaterThan(0);
    }
  });

  it('pins a policy version', () => {
    // Stored on every consent row. Bump it whenever any wording above changes,
    // or past rows will appear to have agreed to text they never saw.
    expect(CONSENT_POLICY_VERSION).toMatch(/^v\d+$/);
  });

  it('tells the client the file is not kept', () => {
    // The temp-storage consent is the one making a promise about our own
    // behaviour, so it must actually say what we do.
    expect(CONSENT_COPY[CONSENT.tempStorage].detail.toLowerCase()).toContain('never stored');
  });
});
