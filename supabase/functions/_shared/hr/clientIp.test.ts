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

describe('the chain Supabase actually produces', () => {
  /*
   * A REGRESSION TEST FOR A REAL OUTAGE OF THE CONTROL.
   *
   * Supabase's edge appends its own hop, so a punch arrives as
   *
   *     106.51.22.75,106.51.22.75, 99.82.173.147
   *
   * where the last entry is AWS Global Accelerator (13.248.x / 99.82.x are
   * Amazon) and ROTATES on every request. Reading the right-most entry meant
   * reading Amazon: a different "office IP" appeared every few punches, and
   * worse, once those pool addresses were trusted the restriction stopped
   * restricting anything -- every punch on earth arrives through that same
   * pool, so a punch from home auto-approved exactly like one from the office.
   *
   * The setting to get right is trusted_proxy_hops, and for this platform it
   * is 1, not 0. These cases pin that down against the real recorded chains.
   */
  const AWS = ['99.82.173.147', '99.82.173.148', '13.248.117.200', '13.248.117.204'];

  it('reads the client, not the rotating Amazon hop', () => {
    for (const aws of AWS) {
      const chain = `106.51.22.75,106.51.22.75, ${aws}`;
      expect(resolveClientIp(h({ 'x-forwarded-for': chain }), 1).ip).toBe('106.51.22.75');
      // and demonstrates what the wrong setting did
      expect(resolveClientIp(h({ 'x-forwarded-for': chain }), 0).ip).toBe(aws);
    }
  });

  it('collapses every rotating hop onto one stable office address', () => {
    const chains = AWS.map(a => `106.51.22.75,106.51.22.75, ${a}`);
    const resolved = new Set(chains.map(c => resolveClientIp(h({ 'x-forwarded-for': c }), 1).ip));
    expect(resolved.size).toBe(1);
  });

  it('still separates a punch made from somewhere else', () => {
    const office = resolveClientIp(h({ 'x-forwarded-for': '106.51.22.75,106.51.22.75, 99.82.173.147' }), 1).ip;
    const mobile = resolveClientIp(h({ 'x-forwarded-for': '152.57.80.145,152.57.80.145, 99.82.173.169' }), 1).ip;
    expect(office).toBe('106.51.22.75');
    expect(mobile).toBe('152.57.80.145');
    expect(office).not.toBe(mobile);
  });

  it('a spoofed header still cannot reach the trusted position', () => {
    // Whatever the client prepends, the infrastructure entries are appended
    // after it, so counting from the right never lands on client-written text.
    const spoofed = '203.0.113.10, 106.51.22.75,106.51.22.75, 99.82.173.147';
    expect(resolveClientIp(h({ 'x-forwarded-for': spoofed }), 1).ip).toBe('106.51.22.75');
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
