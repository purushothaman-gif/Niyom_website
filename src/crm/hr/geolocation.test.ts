import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPosition, permissionState, formatDistance } from './geolocation';

/*
 * Attendance is refused when location cannot be read, so every refusal has to
 * tell the employee what to actually do. A single "location unavailable" for
 * six different causes sends someone with a blocked permission hunting for a
 * GPS problem they do not have.
 */

const withNavigator = (nav: unknown, secure = true) => {
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('window', {
    isSecureContext: secure,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
};

// The two callbacks the browser hands to getCurrentPosition. Typed loosely on
// purpose: each test supplies only the handful of fields the code reads, so
// building a whole GeolocationPosition would be noise.
// accuracy is optional here because some browsers genuinely omit it, which is
// the case one of the tests below covers.
type OkFn  = (p: { coords: { latitude: number; longitude: number; accuracy?: number }; timestamp: number }) => void;
type ErrFn = (e: { code: number; PERMISSION_DENIED: number; POSITION_UNAVAILABLE: number; TIMEOUT: number }) => void;

const geoWith = (impl: (ok: OkFn, err: ErrFn) => void) => ({
  geolocation: { getCurrentPosition: (s: OkFn, e: ErrFn) => impl(s, e) },
});

afterEach(() => vi.unstubAllGlobals());

describe('a successful fix', () => {
  it('returns the coordinates and the accuracy', async () => {
    withNavigator(geoWith((ok) => ok({
      coords: { latitude: 13.0359, longitude: 80.1682, accuracy: 18 }, timestamp: 1000,
    })));
    const r = await getPosition();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.latitude).toBeCloseTo(13.0359, 4);
      expect(r.longitude).toBeCloseTo(80.1682, 4);
      expect(r.accuracy).toBe(18);
    }
  });

  it('substitutes a huge accuracy when the browser omits it', async () => {
    // Better than reporting 0, which would look like a perfect fix and let an
    // unusable position through the server's accuracy check.
    withNavigator(geoWith((ok) => ok({
      coords: { latitude: 1, longitude: 2, accuracy: undefined }, timestamp: 1,
    })));
    const r = await getPosition();
    expect(r.ok && r.accuracy).toBe(99999);
  });
});

describe('each failure gets its own instruction', () => {
  const cases: [number, string, RegExp][] = [
    [1, 'permission', /allow it for this site|padlock/i],
    [2, 'unavailable', /turn on location|near a window/i],
    [3, 'timeout',     /took too long/i],
    [9, 'unknown',     /could not be read/i],
  ];

  for (const [code, reason, hint] of cases) {
    it(`explains a ${reason} failure`, async () => {
      withNavigator(geoWith((_ok, err) =>
        err({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })));
      const r = await getPosition();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe(reason);
        expect(r.message).toMatch(hint);
      }
    });
  }

  it('names an unsupported browser rather than blaming the GPS', async () => {
    withNavigator({});
    const r = await getPosition();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported');
  });

  it('names an insecure connection, which no amount of retrying fixes', async () => {
    withNavigator(geoWith(() => { throw new Error('should not be called'); }), false);
    const r = await getPosition();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('insecure');
      expect(r.message).toMatch(/https/i);
    }
  });

  it('never leaves the caller waiting when the browser answers neither callback', async () => {
    withNavigator(geoWith(() => { /* silence, as when a prompt is dismissed */ }));
    const r = await getPosition(5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  it('every message says what to do next, not just what went wrong', async () => {
    for (const code of [1, 2, 3, 9]) {
      withNavigator(geoWith((_o, err) =>
        err({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })));
      const r = await getPosition();
      if (!r.ok) expect(r.message).toMatch(/try again|allow|turn on|open this page|use chrome/i);
    }
  });
});

describe('permissionState', () => {
  it('reports what the browser already knows', async () => {
    withNavigator({ permissions: { query: async () => ({ state: 'granted' }) } });
    expect(await permissionState()).toBe('granted');
  });

  it('says unknown where the Permissions API is missing, rather than guessing', async () => {
    withNavigator({});
    expect(await permissionState()).toBe('unknown');
  });
});

describe('formatDistance', () => {
  it('uses metres up to a kilometre and km beyond', () => {
    expect(formatDistance(0)).toBe('0 metres');
    expect(formatDistance(87.4)).toBe('87 metres');
    expect(formatDistance(450)).toBe('450 metres');
    expect(formatDistance(999)).toBe('999 metres');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(12500)).toBe('12.5 km');
  });

  it('renders a missing distance as a dash rather than NaN', () => {
    expect(formatDistance(null)).toBe('—');
    expect(formatDistance(undefined)).toBe('—');
    expect(formatDistance(Number.NaN)).toBe('—');
  });
});
