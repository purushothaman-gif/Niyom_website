// Two-factor auth (TOTP) for privileged CRM accounts.
//
// Uses Supabase's native MFA rather than a hand-rolled scheme. That matters for
// more than convenience: a verified TOTP challenge raises the session's
// Authenticator Assurance Level to aal2 and stamps it into the JWT, which means
// the guarantee can eventually be enforced in RLS — the database itself can
// refuse an unverified session. A bolt-on second factor could only ever gate the
// UI, leaving the REST API wide open to anyone holding a stolen password.
//
// Scope: admin + super_admin only, per the rollout decision. RMs are unaffected.
//
// NOTE ON ENFORCEMENT (read before extending):
// This layer is APPLICATION-level — it gates the CRM UI. It raises the bar a lot
// (a stolen password alone no longer gets you into the CRM) but it is not the
// same as RLS enforcement. Requiring aal2 in RLS policies is the stronger step
// and should only be switched on once every admin is enrolled, or they will be
// locked out of their own data.

import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';

// MASTER SWITCH — is a second factor REQUIRED to enter the CRM?
//
// false: MFA is OPTIONAL. Enrolment still works from the login screen for
//        anyone who wants it, but no one is forced to set one up and an
//        already-enrolled user is never challenged — a correct password goes
//        straight in. This is the "less friction" setting.
// true:  MFA is ENFORCED for privileged accounts (admin / super_admin): they
//        must enrol, and every session must step up to aal2.
//
// This only governs the APPLICATION gate. It cannot forge assurance: a session
// that skips the challenge stays aal1, so if aal2 is ever required in RLS the
// database still refuses it. Flip this one line to re-enforce.
export const MFA_REQUIRED = true;

/** Roles required to carry a second factor. */
export function isPrivileged(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function employeeIsPrivileged(emp: Pick<NWEmployee, 'role'> | null | undefined): boolean {
  return isPrivileged(emp?.role);
}

export type MfaGate =
  | 'ok'          // nothing to do — proceed into the CRM
  | 'challenge'   // enrolled, but this session is still aal1 — ask for the code
  | 'enroll';     // privileged and no verified factor yet — must set one up

/**
 * Is a second factor MANDATORY for privileged accounts?
 *
 * false — enrolment is opt-in. A privileged account with no factor goes straight
 * in; one that HAS enrolled is still challenged, because a factor that exists but
 * is not asked for protects nobody. Members turn it on and off themselves from
 * Settings → Security.
 *
 * Flip to true to make it mandatory again — evaluateMfaGate then returns 'enroll'
 * and CRMLogin walks the user through setup on next sign-in. Nothing else needs
 * to change; the enrolment flow is still here and still used.
 *
 * TRADE-OFF: with this false, a stolen or guessed admin password is the ONLY
 * thing between an attacker and every client's PAN, Aadhaar, bank and demat
 * details, the full portfolio book, and the ability to raise payment links.
 */
export const REQUIRE_MFA_FOR_PRIVILEGED = true;

// --- Trusted devices ("remember this device") -------------------------------
//
// A convenience bypass for a person's OWN devices. After a full TOTP
// verification on a given browser, that browser can be remembered so the same
// user is not asked for the 6-digit code again on it until the trust lapses.
//
// This is a deliberate security/convenience trade-off: on a trusted device the
// PASSWORD ALONE re-enters the CRM (the second factor is skipped) until the
// window expires. So it is only appropriate on personal devices the user
// physically controls — never a shared or public computer. The marker is:
//   - per-user AND per-browser (localStorage, keyed by auth user id),
//   - time-boxed (TRUSTED_DEVICE_DAYS), self-expiring,
//   - never transmitted or synced — it cannot move to another device.
// It never raises the session's assurance: a trusted-device login stays aal1,
// so if aal2 is ever required in RLS the database still refuses it. This only
// relaxes the APPLICATION gate.
export const ALLOW_TRUSTED_DEVICES = true;
export const TRUSTED_DEVICE_DAYS = 30;

export const TRUSTED_DEVICE_PREFIX = 'nw_mfa_trusted_';

function trustedDeviceKey(userId: string): string {
  return `${TRUSTED_DEVICE_PREFIX}${userId}`;
}

/** Has THIS browser been remembered for this user, and not yet expired? */
export function isDeviceTrusted(userId: string): boolean {
  if (!ALLOW_TRUSTED_DEVICES || !userId) return false;
  try {
    const raw = localStorage.getItem(trustedDeviceKey(userId));
    if (!raw) return false;
    const { exp } = JSON.parse(raw) as { exp?: number };
    if (typeof exp !== 'number' || Date.now() > exp) {
      localStorage.removeItem(trustedDeviceKey(userId)); // lapsed — clean up
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Remember this browser for the current user, so 2FA is skipped here for a while. */
export async function trustThisDevice(days = TRUSTED_DEVICE_DAYS): Promise<void> {
  if (!ALLOW_TRUSTED_DEVICES) return;
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  try {
    localStorage.setItem(trustedDeviceKey(userId), JSON.stringify({ exp }));
  } catch {
    // Storage unavailable (private mode / quota) — silently fall back to always
    // challenging, which is the safe direction.
  }
}

/** Forget this browser for the current user — the next login here challenges again. */
export async function forgetThisDevice(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;
  try {
    localStorage.removeItem(trustedDeviceKey(userId));
  } catch {
    /* nothing to clean up */
  }
}

/** Is this browser currently remembered for the signed-in user? (for Settings UI) */
export async function currentDeviceTrusted(): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  return data.user ? isDeviceTrusted(data.user.id) : false;
}

/**
 * Clear browser storage on sign-out WITHOUT forgetting trusted devices.
 *
 * Sign-out handlers call localStorage.clear() to drop cached data — but that
 * also wipes the "remember this device" markers, so the user gets challenged
 * again on their own device after every logout, which defeats the feature.
 * This clears everything except the nw_mfa_trusted_* keys, then clears
 * sessionStorage. Use it in place of localStorage.clear()+sessionStorage.clear()
 * in sign-out paths.
 */
export function clearStorageKeepingTrustedDevices(): void {
  try {
    const preserved: Array<[string, string]> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(TRUSTED_DEVICE_PREFIX)) {
        const v = localStorage.getItem(k);
        if (v !== null) preserved.push([k, v]);
      }
    }
    localStorage.clear();
    for (const [k, v] of preserved) localStorage.setItem(k, v);
  } catch {
    /* storage unavailable — nothing to preserve */
  }
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

/**
 * True when the PROJECT has TOTP switched off (Supabase dashboard → Auth → MFA).
 *
 * This is the one case where the gate must NOT be enforced. If the platform
 * offers no TOTP, nobody can enrol, so demanding a factor would lock out every
 * admin — including the person who needs the dashboard to turn it back on. It is
 * not a meaningful weakening either: flipping that switch requires Supabase
 * project access, which is already a total compromise.
 */
export function isMfaUnavailable(err: unknown): boolean {
  const e = err as { message?: string; code?: string; error_code?: string } | undefined;
  // Exact codes from GoTrue's ErrorCode union (@supabase/auth-js error-codes.d.ts).
  // Verified against the shipped typings rather than guessed — an earlier version
  // of this check invented "..._enroll_disabled", which never matches, and would
  // have left every admin locked out with TOTP switched off.
  const code = e?.code ?? e?.error_code;
  if (
    code === 'mfa_totp_enroll_not_enabled' ||
    code === 'mfa_totp_verify_not_enabled' ||
    code === 'mfa_phone_enroll_not_enabled' ||
    code === 'mfa_phone_verify_not_enabled' ||
    code === 'mfa_webauthn_enroll_not_enabled' ||
    code === 'mfa_webauthn_verify_not_enabled'
  ) return true;

  // Message fallback: older GoTrue builds return prose without a code.
  const msg = (e?.message ?? '').toLowerCase();
  return /mfa|totp|webauthn/.test(msg) && /(not enabled|disabled|unsupported)/.test(msg);
}

/**
 * What, if anything, stands between this session and the CRM.
 *
 * Supabase reports nextLevel='aal2' only once a verified factor exists, so the
 * two cases are distinguished by the factor list rather than by AAL alone.
 */
export async function evaluateMfaGate(emp: Pick<NWEmployee, 'role'>): Promise<MfaGate> {
  // MFA turned off at the app layer — never force enrolment, never challenge.
  if (!MFA_REQUIRED) return 'ok';
  if (!employeeIsPrivileged(emp)) return 'ok';

  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalErr) {
    if (isMfaUnavailable(aalErr)) return 'ok'; // TOTP off project-wide — see isMfaUnavailable
    throw aalErr;
  }

  // Already stepped up in this session.
  if (aal?.currentLevel === 'aal2') return 'ok';

  // A verified factor exists -> Supabase wants us at aal2 -> normally challenge.
  // This holds regardless of REQUIRE_MFA_FOR_PRIVILEGED: someone who deliberately
  // enrolled expects to be asked, and skipping it would leave the session at aal1
  // while the account looks protected. To stop being challenged, remove the
  // factor (Settings → Security), which is an explicit act rather than a silent
  // downgrade.
  //
  // EXCEPTION: a browser the user explicitly ticked "remember this device" on
  // (after a real code entry) skips the challenge until that trust lapses. This
  // is opt-in and per-device — see the trusted-device section above.
  if (aal?.nextLevel === 'aal2') {
    const { data: u } = await supabase.auth.getUser();
    if (u.user && isDeviceTrusted(u.user.id)) return 'ok';
    return 'challenge';
  }

  // No verified factor. Mandatory mode sends them through setup; otherwise
  // enrolment is opt-in and they carry on.
  return REQUIRE_MFA_FOR_PRIVILEGED ? 'enroll' : 'ok';
}

/**
 * Remove every verified TOTP factor on the current user — i.e. turn 2FA off.
 *
 * Deliberately NOT called anywhere automatically. Dropping a second factor is a
 * decision a person makes about their own account, so it is only reachable from
 * Settings → Security behind an explicit confirmation.
 */
export async function disableTotp(): Promise<void> {
  const factors = await listVerifiedTotpFactors();
  for (const f of factors) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) throw error;
  }
}

/** Verified TOTP factors on the current user, if any. */
export async function listVerifiedTotpFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp ?? []).filter((f) => f.status === 'verified');
}

export interface TotpEnrollment {
  factorId: string;
  /** SVG data-URI produced by Supabase — renderable directly, no QR library. */
  qrCode: string;
  /** Shown so the code can be typed in by hand when a camera isn't available. */
  secret: string;
}

/**
 * Begin TOTP enrolment.
 *
 * Any unverified factor left behind by an abandoned attempt is removed first:
 * Supabase rejects a second enrolment with the same friendly name, so a user who
 * bailed out halfway would otherwise be permanently unable to retry.
 */
export async function startTotpEnrollment(friendlyName = 'Niyom CRM'): Promise<TotpEnrollment> {
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.totp ?? []) {
    if (f.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) throw error;

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/**
 * Submit a 6-digit code against a factor. Used for both the final step of
 * enrolment and for the per-login challenge — Supabase treats them the same.
 * On success the session is upgraded to aal2.
 */
export async function verifyTotpCode(factorId: string, code: string): Promise<void> {
  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
  if (cErr) throw cErr;

  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });
  if (vErr) throw vErr;
}

/** Drop a half-finished enrolment (user cancelled the setup screen). */
export async function cancelEnrollment(factorId: string): Promise<void> {
  try {
    await supabase.auth.mfa.unenroll({ factorId });
  } catch {
    // Best-effort: a stale unverified factor is cleaned up on the next attempt.
  }
}

/** Turn Supabase's auth errors into something a person can act on. */
export function mfaErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? '';
  if (/invalid|incorrect/i.test(msg) && /code|totp/i.test(msg)) {
    return 'That code is not right. Check your authenticator app and try again.';
  }
  if (/expired/i.test(msg)) {
    return 'That code has expired. Enter the current one from your app.';
  }
  if (/rate|too many/i.test(msg)) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  // Surfaced when TOTP is switched off for the project.
  if (/disabled|not enabled|unsupported/i.test(msg)) {
    return 'Two-factor authentication is not enabled for this project yet.';
  }
  return msg || 'Could not verify the code. Please try again.';
}
