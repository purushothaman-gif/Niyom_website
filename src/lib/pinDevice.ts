/**
 * Device identity for PIN sign-in.
 *
 * The device id is an opaque random string kept in localStorage. It is a NAME,
 * not a credential: on its own it grants nothing, and the server treats it as
 * untrusted input. Pairing it with a PIN is what signs someone in, and the
 * server counts the tries.
 *
 * `nw_pin_client` is a local hint that this browser has a PIN set, so the login
 * screen can open on the keypad instead of asking everyone. It is a UI
 * shortcut: deleting it costs the client nothing but one password login, and
 * forging it gets an attacker a keypad that rejects them.
 */

const DEVICE_KEY = 'nw_pin_device_id';
const HINT_KEY = 'nw_pin_client';

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
    /* PIN sign-in simply won't persist here; password login is unaffected */
  }
}

function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
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

/** True when this browser believes it has a PIN set. */
export function hasPinHint(): boolean {
  return !!readLocal(HINT_KEY);
}

export function setPinHint(clientId: string): void {
  writeLocal(HINT_KEY, clientId);
}

export function clearPinHint(): void {
  removeLocal(HINT_KEY);
}
