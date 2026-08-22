/**
 * Resolving the client's public IP from an edge-function request.
 *
 * THE THREAT: `X-Forwarded-For` is a client-writable header. Anyone can send
 *
 *     X-Forwarded-For: 203.0.113.10        (the office IP they want to fake)
 *
 * and the platform in front of the function does NOT replace it -- it APPENDS
 * the address it actually observed. So the header the function receives is
 *
 *     <whatever the client claimed>, <the real client IP>
 *
 * which means the trustworthy entry is the RIGHT-most one, not `[0]`. Reading
 * `split(",")[0]` -- which is the common idiom, and is what one older function
 * in this codebase does -- reads exactly the value an attacker controls.
 *
 * `hops` exists because the correct index is "how many proxies you trust",
 * counted from the right. With no proxy of our own in front of the function
 * that is 0 (the last entry). If a CDN or a reverse proxy is ever put in the
 * path, each one appends another entry and `hops` moves left by one.
 *
 * Everything here is a pure string function so the assumption above is pinned
 * down by tests rather than by a comment.
 */

export interface ResolvedIp {
  /** The address to trust, or null when the header is missing or unusable. */
  ip: string | null;
  /** The raw header, stored on the punch so observe mode can be audited. */
  raw: string;
  /** Why an address could not be resolved -- surfaced in logs, not to users. */
  reason?: 'missing' | 'empty' | 'unparseable' | 'hops_exceed_chain';
}

/** Strip an optional :port and IPv6 brackets: "[2001:db8::1]:443" -> "2001:db8::1". */
function stripPort(value: string): string {
  const v = value.trim();
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end > 0) return v.slice(1, end);
    return v.slice(1);
  }
  // Only strip a port from IPv4/hostname forms. A bare IPv6 address is full of
  // colons, so "count of colons === 1" is what distinguishes "1.2.3.4:80" from
  // "2001:db8::1".
  const colons = (v.match(/:/g) || []).length;
  if (colons === 1) return v.slice(0, v.indexOf(':'));
  return v;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Postgres `inet` accepts both families, so this only has to reject values that
 * would make the cast throw -- it is a shape check, not a validator.
 */
export function isProbablyIp(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (IPV4.test(v)) return true;
  // IPv6: hex groups and colons only, at least one colon, no stray characters.
  return v.includes(':') && /^[0-9a-fA-F:.]+$/.test(v);
}

/**
 * An IPv4-mapped IPv6 address ("::ffff:203.0.113.10") is the same machine as
 * the plain IPv4 form, but compares unequal to it. Normalising here is what
 * stops an office IP silently failing to match when a hop upgrades the family.
 */
export function normaliseIp(value: string): string {
  const v = value.trim();
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(v);
  if (mapped && IPV4.test(mapped[1])) return mapped[1];
  return v;
}

/**
 * Resolve the client IP from request headers.
 *
 * @param headers  the incoming request's headers
 * @param hops     trusted proxies in front of this function, counted from the
 *                 right of X-Forwarded-For. 0 = the last entry.
 */
export function resolveClientIp(headers: Headers, hops = 0): ResolvedIp {
  const raw = headers.get('x-forwarded-for') ?? '';

  if (!raw.trim()) {
    // Some platforms expose the peer directly. Never client-writable in the
    // same way, so it is a safe fallback -- but if neither exists we fail
    // closed rather than guessing.
    const direct = headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? '';
    if (direct.trim()) {
      const one = normaliseIp(stripPort(direct));
      return isProbablyIp(one)
        ? { ip: one, raw: direct }
        : { ip: null, raw: direct, reason: 'unparseable' };
    }
    return { ip: null, raw, reason: raw ? 'empty' : 'missing' };
  }

  const parts = raw.split(',').map(p => normaliseIp(stripPort(p))).filter(p => p.length > 0);
  if (parts.length === 0) return { ip: null, raw, reason: 'empty' };

  const index = parts.length - 1 - hops;
  if (index < 0) return { ip: null, raw, reason: 'hops_exceed_chain' };

  const candidate = parts[index];
  if (!isProbablyIp(candidate)) return { ip: null, raw, reason: 'unparseable' };

  return { ip: candidate, raw };
}
