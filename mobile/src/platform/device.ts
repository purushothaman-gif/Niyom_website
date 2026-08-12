/**
 * Device identity, and which accounts have a PIN on this handset.
 * -----------------------------------------------------------------------------
 * A port of `src/lib/pinDevice.ts`, keeping the two things the server actually
 * checks byte-identical: the device id is 32 hex characters (the `*-pin-login`
 * edge functions reject anything else outright), and the remembered profile
 * holds only a display name and a MASKED email.
 *
 * The device id is a NAME, not a credential. On its own it grants nothing; the
 * server treats it as untrusted input, and pairing it with the right PIN is what
 * signs someone in. It lives in SecureStore rather than the app's documents so
 * it is not readable from a device backup.
 *
 * Profiles are deliberately NOT secret — they decide which screen shows first
 * and whose name appears above the keypad. Forging one gets an attacker a
 * keypad that rejects them.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DEVICE_KEY = 'nw_pin_device_id';
const PROFILES_KEY = 'nw_pin_profiles';

/** Client PINs and partner PINs share the device but not the profile list. */
export type PinSurface = 'client' | 'partner';

export interface PinProfile {
  /** `client_id` or `dsa_id`, depending on the surface. */
  id: string;
  name: string;
  /** Already masked when saved, e.g. "a••••••n@gmail.com". */
  maskedEmail: string;
}

let cachedDeviceId: string | null = null;

/** This device's id, created on first use. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const existing = await SecureStore.getItemAsync(DEVICE_KEY).catch(() => null);
  if (existing && /^[a-f0-9]{32,64}$/i.test(existing)) {
    cachedDeviceId = existing;
    return existing;
  }

  const bytes = Crypto.getRandomBytes(16);
  const id = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await SecureStore.setItemAsync(DEVICE_KEY, id).catch(() => {
    /* PIN sign-in just will not persist; password login is unaffected */
  });
  cachedDeviceId = id;
  return id;
}

/** "anand.kumar@gmail.com" → "a••••••••••r@gmail.com". Matches the website. */
export function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  if (local.length <= 2) return `${local[0]}••@${domain}`;
  return `${local[0]}${'•'.repeat(Math.min(local.length - 2, 12))}${local[local.length - 1]}@${domain}`;
}

const profilesKey = (surface: PinSurface) => `${PROFILES_KEY}_${surface}`;

export async function listProfiles(surface: PinSurface): Promise<PinProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(profilesKey(surface));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PinProfile =>
        !!p && typeof p.id === 'string' && typeof p.name === 'string',
    );
  } catch {
    return [];
  }
}

export async function saveProfile(surface: PinSurface, profile: PinProfile): Promise<void> {
  const others = (await listProfiles(surface)).filter((p) => p.id !== profile.id);
  await AsyncStorage.setItem(profilesKey(surface), JSON.stringify([...others, profile]));
}

export async function removeProfile(surface: PinSurface, id: string): Promise<void> {
  const left = (await listProfiles(surface)).filter((p) => p.id !== id);
  await AsyncStorage.setItem(profilesKey(surface), JSON.stringify(left));
  // A forgotten profile must not leave its biometric copy of the PIN behind.
  await forgetBiometricPin(surface, id);
}

export async function hasProfile(surface: PinSurface, id: string): Promise<boolean> {
  return (await listProfiles(surface)).some((p) => p.id === id);
}

/* ----------------------- "Set a PIN?" prompt state ------------------------ */

/**
 * How many times an account may be offered a PIN before we take the hint.
 * Three, as on the website: the first sign-in is often a hurried one, and a
 * second and third ask catch the person who meant to and forgot.
 */
export const PIN_PROMPT_LIMIT = 3;

const promptKey = (surface: PinSurface, id: string) => `nw_pin_prompt_skips_${surface}:${id}`;

export async function pinPromptSkips(surface: PinSurface, id: string): Promise<number> {
  const raw = await AsyncStorage.getItem(promptKey(surface, id)).catch(() => null);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function recordPinPromptSkip(surface: PinSurface, id: string): Promise<void> {
  const n = await pinPromptSkips(surface, id);
  await AsyncStorage.setItem(promptKey(surface, id), String(n + 1)).catch(() => {});
}

export async function silencePinPrompt(surface: PinSurface, id: string): Promise<void> {
  await AsyncStorage.setItem(promptKey(surface, id), String(PIN_PROMPT_LIMIT)).catch(() => {});
}

/* --------------------------- Biometric PIN vault -------------------------- */
/*
 * Face ID does not replace the PIN — it releases it.
 *
 * The server is the only thing that can turn four digits into a session, and it
 * is the only thing counting wrong tries. So rather than inventing a second,
 * weaker way in, an enrolled device keeps the PIN itself in the keychain behind
 * a biometric access-control flag: Face ID unlocks the item, and the PIN then
 * goes to the SAME `*-pin-login` endpoint the keypad uses. Nothing about the
 * server's lockout, burn-after-ten or kill-switch behaviour changes.
 *
 * Stored whole rather than chunked: a 4-digit PIN is nowhere near SecureStore's
 * 2048-byte ceiling, and chunking would prompt for Face ID once per chunk.
 */

const biometricPinKey = (surface: PinSurface, id: string) =>
  `nw_bio_pin_${surface}_${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export async function saveBiometricPin(
  surface: PinSurface,
  id: string,
  pin: string,
): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(biometricPinKey(surface, id), pin, {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: 'Confirm it is you to enable Face ID sign-in',
    });
    return true;
  } catch {
    // No enrolled biometric, or the user declined. The keypad still works.
    return false;
  }
}

/** Prompts for Face ID / fingerprint; resolves null if it fails or is declined. */
export async function readBiometricPin(
  surface: PinSurface,
  id: string,
): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(biometricPinKey(surface, id), {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: 'Unlock Niyom Wealth',
    });
  } catch {
    return null;
  }
}

export async function hasBiometricPin(surface: PinSurface, id: string): Promise<boolean> {
  /*
   * Deliberately not a read: checking by reading would throw a Face ID prompt
   * at the client just to decide whether to DRAW the Face ID button. The flag
   * is kept unprotected alongside it, and it says only "an item exists".
   */
  const flag = await AsyncStorage.getItem(`${biometricPinKey(surface, id)}__set`).catch(() => null);
  return flag === '1';
}

export async function markBiometricPin(surface: PinSurface, id: string): Promise<void> {
  await AsyncStorage.setItem(`${biometricPinKey(surface, id)}__set`, '1').catch(() => {});
}

export async function forgetBiometricPin(surface: PinSurface, id: string): Promise<void> {
  await SecureStore.deleteItemAsync(biometricPinKey(surface, id)).catch(() => {});
  await AsyncStorage.removeItem(`${biometricPinKey(surface, id)}__set`).catch(() => {});
}
