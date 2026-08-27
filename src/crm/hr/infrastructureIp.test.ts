import { describe, it, expect } from 'vitest';
import { looksLikeInfrastructure } from './infrastructureIp';

/*
 * Guards the warning that would have caught a four-day outage of the office
 * restriction: the server was reading Supabase's own AWS hop, so the addresses
 * being trusted were Amazon's, and every punch on earth arrives through those.
 */
describe('looksLikeInfrastructure', () => {
  it('flags the exact addresses that were wrongly trusted', () => {
    for (const ip of ['13.248.117.200', '13.248.117.204', '99.82.173.147', '99.82.173.148']) {
      expect(looksLikeInfrastructure(ip)).toBe(true);
    }
  });

  it('flags the other big clouds', () => {
    for (const ip of ['52.1.2.3', '54.2.3.4', '34.9.9.9', '104.16.1.1', '20.1.2.3']) {
      expect(looksLikeInfrastructure(ip)).toBe(true);
    }
  });

  it('does not flag the real office or ordinary Indian ISP addresses', () => {
    for (const ip of ['106.51.22.75', '152.57.80.145', '122.167.101.190', '49.37.200.5']) {
      expect(looksLikeInfrastructure(ip)).toBe(false);
    }
  });

  it('does not flag a private address, which fails for a different reason', () => {
    // A 192.168.x address is useless as an office identifier, but it is not
    // cloud infrastructure and this warning is not the one to raise for it.
    expect(looksLikeInfrastructure('192.168.1.1')).toBe(false);
    expect(looksLikeInfrastructure('10.0.0.1')).toBe(false);
  });
});
