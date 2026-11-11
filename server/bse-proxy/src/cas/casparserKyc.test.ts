/**
 * KYC + ARN response mapping.
 *
 * Pinned because the two fields that drive a decision — `compliant` and the
 * adverse-list `negativeListHit` — must never read as a pass by accident: a
 * missing or odd value has to fail closed, not open.
 */
import { describe, expect, it } from 'vitest';
import { mapArn, mapKycStatus } from './casparserKyc.js';

describe('mapKycStatus', () => {
  it('passes through the normalised status and compliance gate', () => {
    const k = mapKycStatus({
      kyc_compliant: true,
      kyc_status: 'validated',
      active_kra: 'cvl',
      registered_on: '2020-07-02',
      kras: { cvl: { status: 'validated' } },
    });
    expect(k).toMatchObject({ status: 'validated', compliant: true, activeKra: 'cvl' });
    expect(k.kras).toHaveProperty('cvl');
  });

  it('fails closed when compliance is absent or not a true boolean', () => {
    expect(mapKycStatus({ kyc_status: 'on_hold' }).compliant).toBe(false);
    expect(mapKycStatus({ kyc_compliant: 'true' as unknown as boolean }).compliant).toBe(false);
    expect(mapKycStatus({}).status).toBe('unknown');
    expect(mapKycStatus({}).activeKra).toBeNull();
  });
});

describe('mapArn', () => {
  it('treats an active, clean ARN as verified', () => {
    const a = mapArn({ arn: '123456', verified: true, registration_status: 'ACTIVE', name: 'ABC', euin: 'E123' });
    expect(a).toMatchObject({ verified: true, registrationStatus: 'ACTIVE', negativeListHit: false });
  });

  it('surfaces a suspended/terminated ARN as an adverse hit, never just not-verified', () => {
    const a = mapArn({
      arn: '999',
      verified: false,
      registration_status: 'SUSPENDED',
      negative_list_hit: true,
      negative_list: { type: 'suspended', since: '2025-01-01' },
    });
    expect(a.verified).toBe(false);
    expect(a.negativeListHit).toBe(true);
    expect(a.negativeList).toMatchObject({ type: 'suspended' });
  });

  it('fails closed on a missing verified flag and defaults to NOT_FOUND', () => {
    const a = mapArn({ arn: '1' });
    expect(a.verified).toBe(false);
    expect(a.registrationStatus).toBe('NOT_FOUND');
    expect(a.negativeListHit).toBe(false);
  });
});
