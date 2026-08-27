/**
 * Getting the employee's position for an attendance punch.
 *
 * Pure browser plumbing, kept out of the component so every failure mode can be
 * named, tested, and turned into a sentence the employee can act on. There are
 * six distinct ways this fails and they need six different answers -- "location
 * unavailable" tells someone with a blocked permission nothing useful.
 *
 * Nothing here decides anything. It reports a position or a reason it could
 * not; the server decides whether that position is at the office.
 */

export type GeoFailure =
  | 'unsupported'      // the browser has no Geolocation API at all
  | 'permission'       // the user or the browser refused
  | 'insecure'         // not HTTPS, so the API refuses to run
  | 'unavailable'      // no fix: indoors, no GPS hardware, radios off
  | 'timeout'          // a fix did not arrive in time
  | 'unknown';

export interface GeoFix {
  ok: true;
  latitude: number;
  longitude: number;
  /** Radius of 68% confidence, in metres, as the browser reports it. */
  accuracy: number;
  at: number;
}

export interface GeoError {
  ok: false;
  reason: GeoFailure;
  /** Shown to the employee. Says what happened AND what to do next. */
  message: string;
}

export type GeoResult = GeoFix | GeoError;

const MESSAGES: Record<GeoFailure, string> = {
  unsupported:
    'This browser cannot provide your location, so attendance cannot be marked here. Please use Chrome or Safari on your phone.',
  permission:
    'Attendance needs your location, and location access is blocked. Allow it for this site in your browser settings — on Chrome, tap the padlock in the address bar and turn Location on — then try again.',
  insecure:
    'Your location can only be read over a secure connection. Please open this page using its https:// address.',
  unavailable:
    'Your device could not get a location fix. Turn on location or GPS, move near a window or step outside, and try again.',
  timeout:
    'Getting your location took too long. Check that location is switched on, then try again — it is usually quicker outdoors.',
  unknown:
    'Your location could not be read. Check that location access is switched on for this site, then try again.',
};

const fail = (reason: GeoFailure): GeoError => ({ ok: false, reason, message: MESSAGES[reason] });

/**
 * Ask the browser where we are.
 *
 * `timeoutMs` is generous on purpose: a cold GPS fix indoors genuinely takes
 * many seconds, and a short timeout would fail the honest majority in order to
 * feel responsive.
 */
export function getPosition(timeoutMs = 15000): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(fail('unsupported'));
  }

  // The API is disabled outside a secure context, and the error it raises then
  // is an unhelpful generic one. Detected up front so the message can name the
  // actual problem.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return Promise.resolve(fail('insecure'));
  }

  return new Promise<GeoResult>(resolve => {
    let settled = false;
    const done = (r: GeoResult) => { if (!settled) { settled = true; resolve(r); } };

    // Some browsers never invoke either callback if the permission prompt is
    // dismissed rather than answered, so the promise gets its own deadline.
    const guard = window.setTimeout(() => done(fail('timeout')), timeoutMs + 2000);

    navigator.geolocation.getCurrentPosition(
      pos => {
        window.clearTimeout(guard);
        done({
          ok: true,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          // Absent on some desktop browsers; a large number is the honest
          // stand-in, and the server will judge it too imprecise to use.
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 99999,
          at: pos.timestamp,
        });
      },
      err => {
        window.clearTimeout(guard);
        done(fail(
          err.code === err.PERMISSION_DENIED ? 'permission'
          : err.code === err.POSITION_UNAVAILABLE ? 'unavailable'
          : err.code === err.TIMEOUT ? 'timeout'
          : 'unknown',
        ));
      },
      // enableHighAccuracy asks for GPS rather than a network-derived guess.
      // maximumAge 0 forbids a cached fix: attendance must reflect where the
      // person is now, not where the browser last saw them.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/**
 * Has the user already granted or blocked location?
 *
 * Lets the card explain itself before triggering a prompt. The Permissions API
 * is not universal, so an unknown answer is normal and simply means "ask".
 */
export async function permissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const s = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return s.state as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'unknown';
  }
}

/** Metres for anything under a kilometre, then kilometres to one decimal. */
export function formatDistance(metres: number | null | undefined): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} metres`;
  return `${(metres / 1000).toFixed(1)} km`;
}
