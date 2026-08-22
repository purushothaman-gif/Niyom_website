import { describe, it, expect } from 'vitest';
import { resolveClientIp, isProbablyIp, normaliseIp } from './clientIp.ts';

const h = (values: Record<string, string>) => new Headers(values);

describe('resolveClientIp', () => {
  it('takes the only entry when there is no chain', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '203.0.113.10' })).ip).toBe('203.0.113.10');
  });

  /*
   * The reason this module exists. A client that sends its own
   * X-Forwarded-For gets it PREPENDED to what the platform observed, so the
   * spoofed value sits at index 0 and the real address at the end. Reading
   * [0] would hand an attacker the office IP.
   */
  it('ignores a spoofed value the client prepended', () => {
    const spoofed = '203.0.113.10, 49.37.200.5';
    expect(resolveClientIp(h({ 'x-forwarded-for': spoofed })).ip).toBe('49.37.200.5');
  });

  it('ignores several spoofed entries', () => {
    const r = resolveClientIp(h({ 'x-forwarded-for': '203.0.113.10, 203.0.113.11, 10.0.0.1, 49.37.200.5' }));
    expect(r.ip).toBe('49.37.200.5');
  });

  it('moves left by one for each trusted proxy hop', () => {
    const chain = '203.0.113.10, 49.37.200.5, 172.16.0.9';
    expect(resolveClientIp(h({ 'x-forwarded-for': chain }), 0).ip).toBe('172.16.0.9');
    expect(resolveClientIp(h({ 'x-forwarded-for': chain }), 1).ip).toBe('49.37.200.5');
  });

  it('fails closed when more hops are claimed than the chain has', () => {
    const r = resolveClientIp(h({ 'x-forwarded-for': '49.37.200.5' }), 3);
    expect(r.ip).toBeNull();
    expect(r.reason).toBe('hops_exceed_chain');
  });

  it('tolerates the whitespace real proxies emit', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '  203.0.113.10 ,   49.37.200.5  ' })).ip).toBe('49.37.200.5');
  });

  it('strips a port from an IPv4 entry', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '49.37.200.5:51234' })).ip).toBe('49.37.200.5');
  });

  it('keeps a bare IPv6 address intact', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '2001:db8::1' })).ip).toBe('2001:db8::1');
  });

  it('strips the port from a bracketed IPv6 entry', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '[2001:db8::1]:443' })).ip).toBe('2001:db8::1');
  });

  /*
   * A hop that upgrades the family writes the same machine as
   * ::ffff:49.37.200.5. Postgres compares that unequal to 49.37.200.5, so
   * without normalising, an allowlisted office IP would silently stop matching.
   */
  it('normalises an IPv4-mapped IPv6 address to its IPv4 form', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '::ffff:49.37.200.5' })).ip).toBe('49.37.200.5');
  });

  it('returns null when the header is absent', () => {
    const r = resolveClientIp(h({}));
    expect(r.ip).toBeNull();
    expect(r.reason).toBe('missing');
  });

  it('returns null for a header that is only separators', () => {
    const r = resolveClientIp(h({ 'x-forwarded-for': ' , , ' }));
    expect(r.ip).toBeNull();
  });

  it('rejects a garbage entry rather than passing it to the inet cast', () => {
    const r = resolveClientIp(h({ 'x-forwarded-for': 'not-an-ip' }));
    expect(r.ip).toBeNull();
    expect(r.reason).toBe('unparseable');
  });

  it('rejects an out-of-range IPv4 octet', () => {
    expect(resolveClientIp(h({ 'x-forwarded-for': '999.1.1.1' })).ip).toBeNull();
  });

  it('falls back to cf-connecting-ip only when there is no forwarded-for', () => {
    expect(resolveClientIp(h({ 'cf-connecting-ip': '49.37.200.5' })).ip).toBe('49.37.200.5');
    // and never prefers it over the forwarded chain
    expect(resolveClientIp(h({
      'x-forwarded-for': '203.0.113.10, 49.37.200.5',
      'cf-connecting-ip': '1.2.3.4',
    })).ip).toBe('49.37.200.5');
  });

  it('always returns the raw header for the audit record', () => {
    const raw = '203.0.113.10, 49.37.200.5';
    expect(resolveClientIp(h({ 'x-forwarded-for': raw })).raw).toBe(raw);
  });
});

describe('isProbablyIp', () => {
  it('accepts valid IPv4 and IPv6', () => {
    expect(isProbablyIp('10.0.0.1')).toBe(true);
    expect(isProbablyIp('255.255.255.255')).toBe(true);
    expect(isProbablyIp('2001:db8::1')).toBe(true);
    expect(isProbablyIp('::1')).toBe(true);
  });

  it('rejects things that would make an inet cast throw', () => {
    expect(isProbablyIp('')).toBe(false);
    expect(isProbablyIp('localhost')).toBe(false);
    expect(isProbablyIp('256.1.1.1')).toBe(false);
    expect(isProbablyIp('1.2.3')).toBe(false);
    expect(isProbablyIp("1.2.3.4'; drop table hr_attendance_punches--")).toBe(false);
  });
});

describe('normaliseIp', () => {
  it('leaves ordinary addresses alone', () => {
    expect(normaliseIp('49.37.200.5')).toBe('49.37.200.5');
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('unwraps IPv4-mapped IPv6 in either case', () => {
    expect(normaliseIp('::ffff:49.37.200.5')).toBe('49.37.200.5');
    expect(normaliseIp('::FFFF:49.37.200.5')).toBe('49.37.200.5');
  });
});
