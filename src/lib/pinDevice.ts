/**
 * Device identity and remembered profiles for PIN sign-in.
 *
 * The device id is an opaque random string in localStorage. It is a NAME, not a
 * credential: on its own it grants nothing, and the server treats it as
 * untrusted input. Pairing it with the right PIN is what signs someone in, and
 * the server counts the tries.
 *
 * Alongside it sits the list of profiles that have a PIN on this browser, so
 * the keypad can say WHOSE account is being unlocked. That matters most where
 * a family shares a laptop: two Niyom accounts on one device is the case where
 * typing a PIN blind gets you the wrong portfolio.
 *
 * Only a display name and a MASKED email are stored — enough to recognise
 * yourself, not a copy of the client's contact details. Forging any of it gets
 * an attacker a keypad that rejects them.
 */

const DEVICE_KEY = 'nw_pin_device_id';
const PROFILES_KEY = 'nw_pin_profiles';

export interface PinProfile {
  clientId: string;
  name: string;
  /** Already masked at save time, e.g. "a••••••n@gmail.com". */
  maskedEmail: string;
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // Safari private mode
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* PIN sign-in just won't persist here; password login is unaffected */
  }
}

/** This browser's device id, created on first use. */
export function getDeviceId(): string {
  const existing = readLocal(DEVICE_KEY);
  if (existing && /^[a-f0-9]{32,64}$/i.test(existing)) return existing;

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  writeLocal(DEVICE_KEY, id);
  return id;
}

/** A human label for the device list. Best-effort and display-only. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'this device';
  return `${browser} on ${os}`;
}

/** "anand.kumar@gmail.com" → "a••••••••••r@gmail.com". */
export function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  if (local.length <= 2) return `${local[0]}••@${domain}`;
  return `${local[0]}${'•'.repeat(Math.min(local.length - 2, 12))}${local[local.length - 1]}@${domain}`;
}

/** Profiles with a PIN on this browser, in the order they were added. */
export function listProfiles(): PinProfile[] {
  const raw = readLocal(PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PinProfile => !!p && typeof p.clientId === 'string' && typeof p.name === 'string',
    );
  } catch {
    return [];
  }
}

export function saveProfile(profile: PinProfile): void {
  const others = listProfiles().filter((p) => p.clientId !== profile.clientId);
  writeLocal(PROFILES_KEY, JSON.stringify([...others, profile]));
}

export function removeProfile(clientId: string): void {
  writeLocal(PROFILES_KEY, JSON.stringify(listProfiles().filter((p) => p.clientId !== clientId)));
}

export function hasProfiles(): boolean {
  return listProfiles().length > 0;
}

export function hasProfile(clientId: string): boolean {
  return listProfiles().some((p) => p.clientId === clientId);
}

/* ------------------------- "Set a PIN?" prompt state ---------------------- */

/**
 * How many times a client may be offered a PIN before we take the hint. Three
 * because the first login is often a hurried one, and a second and third ask
 * catch the person who meant to and forgot — beyond that it is nagging, and
 * Profile → Settings is always there.
 */
export const PIN_PROMPT_LIMIT = 3;

const promptKey = (clientId: string) => `nw_pin_prompt_skips:${clientId}`;

export function pinPromptSkips(clientId: string): number {
  const raw = readLocal(promptKey(clientId));
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function recordPinPromptSkip(clientId: string): void {
  writeLocal(promptKey(clientId), String(pinPromptSkips(clientId) + 1));
}

/** Stop asking — they set one, or they have refused enough times. */
export function silencePinPrompt(clientId: string): void {
  writeLocal(promptKey(clientId), String(PIN_PROMPT_LIMIT));
}
