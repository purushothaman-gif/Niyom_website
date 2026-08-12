/**
 * Every call the app makes to sign someone in.
 * -----------------------------------------------------------------------------
 * These are the SAME edge functions niyomwealth.com calls, with the same
 * payloads and the same responses — `client-pan-login`, `client-pin-login`,
 * `partner-pan-login`, the OTP senders and the two password-reset endpoints.
 * Nothing was added for the app, and nothing about a client's or a partner's
 * credentials changes because they installed it.
 *
 * ## What the app never does
 *
 * It never builds a session itself. Every route ends either in
 * `signInWithPassword` or in exchanging a one-time `token_hash` the server
 * minted via `verifyOtp` — exactly as the browser does. And it never counts
 * failed PIN attempts: the cool-off, the burn-after-ten and the kill-switch all
 * live server-side, which is the only place a four-digit secret can be made
 * safe.
 */
import { getEnv } from '@shared/platform/env';
import { clientSupabase, partnerSupabase } from '@/platform/supabase';

export interface FnResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T & { error?: string; code?: string };
}

/**
 * An unauthenticated edge-function call.
 *
 * The anon key travels as both `Authorization` and `Apikey`, matching the
 * website — some of these functions run with `verify_jwt` on and read the
 * bearer, others with it off and read the apikey.
 */
export async function callPublicFn<T = Record<string, unknown>>(
  name: string,
  payload: unknown,
): Promise<FnResult<T>> {
  const { supabaseUrl, supabaseAnonKey } = getEnv();
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseAnonKey}`,
        Apikey: supabaseAnonKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data as FnResult<T>['data'] };
  } catch {
    /*
     * A phone loses signal mid-request constantly, and the screens above treat
     * `ok: false` as "that did not work" either way. Status 0 marks it as a
     * transport failure so a caller can say "check your connection" instead of
     * "wrong password".
     */
    return { ok: false, status: 0, data: { error: 'No connection. Check your network and try again.' } as never };
  }
}

/* ------------------------------- Client ---------------------------------- */

export interface ClientIdentity {
  client_id: string;
  client_email: string;
  password_changed: boolean;
}

/** PAN → the client's email, via the service-role function (no RLS exposure). */
export async function lookupClientByPan(pan: string): Promise<ClientIdentity | null> {
  const { ok, data } = await callPublicFn<ClientIdentity>('client-pan-login', { pan });
  if (!ok || !data?.client_email) return null;
  return data;
}

export interface SignInOutcome {
  ok: boolean;
  /** `client_id` or `dsa_id`. */
  id?: string;
  /** False routes the user through the forced password-change screen. */
  passwordChanged?: boolean;
  error?: string;
}

export async function clientSignIn(pan: string, password: string): Promise<SignInOutcome> {
  const client = await lookupClientByPan(pan);
  /*
   * An unknown PAN and a wrong password give the SAME answer. Saying "no such
   * PAN" would turn this endpoint into a way to ask whether a given person is a
   * Niyom client.
   */
  if (!client) return { ok: false, error: 'Invalid PAN or password.' };

  const { data, error } = await clientSupabase.auth.signInWithPassword({
    email: client.client_email,
    password,
  });
  if (error || !data?.user) return { ok: false, error: 'Invalid PAN or password.' };

  return { ok: true, id: client.client_id, passwordChanged: client.password_changed };
}

/**
 * PIN sign-in. The app proves nothing: it sends the device id, which account on
 * this device, and four digits. The server either mints a one-time token or
 * counts another failure.
 */
export async function clientPinSignIn(
  deviceId: string,
  clientId: string,
  pin: string,
): Promise<SignInOutcome & { code?: string }> {
  const { ok, data } = await callPublicFn<{
    token_hash: string;
    client_id: string;
    password_changed: boolean;
  }>('client-pin-login', { device_id: deviceId, client_id: clientId, pin });

  if (!ok || !data?.token_hash) {
    return {
      ok: false,
      error: data?.error || 'That PIN didn’t work. Please try again.',
      code: data?.code,
    };
  }

  const { error } = await clientSupabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'email',
  });
  if (error) return { ok: false, error: 'Could not sign you in. Please try again.' };

  return { ok: true, id: data.client_id, passwordChanged: data.password_changed !== false };
}

/** Email-OTP sign-in, for clients still completing KYC who have no password. */
export async function clientSendLoginOtp(email: string) {
  return callPublicFn<{ email_masked: string }>('public-onboard-send-otp', { email });
}

export async function clientVerifyLoginOtp(email: string, otp: string): Promise<SignInOutcome> {
  const { ok, data } = await callPublicFn<{
    token_hash: string;
    client_id: string;
    password_changed: boolean;
  }>('public-onboard-verify-otp', { email, otp });

  if (!ok || !data?.token_hash) return { ok: false, error: data?.error || 'Verification failed.' };

  const { error } = await clientSupabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'email',
  });
  if (error) return { ok: false, error: 'Could not sign you in. Please try again.' };

  return { ok: true, id: data.client_id, passwordChanged: data.password_changed !== false };
}

/* Password reset — PAN → emailed 6-digit code → new password. Three steps
 * because the server verifies the code WITHOUT consuming it, so the client can
 * be shown the password fields before spending their one code. */
export const clientReset = {
  sendCode: (pan: string) => callPublicFn('send-client-reset-otp', { pan }),
  verifyCode: (pan: string, otp: string) =>
    callPublicFn<{ verified: boolean }>('reset-client-password-with-otp', {
      action: 'verify',
      pan,
      otp,
    }),
  setPassword: (pan: string, otp: string, password: string) =>
    callPublicFn('reset-client-password-with-otp', { action: 'reset', pan, otp, password }),
};

/** Enrol a PIN for this device. Requires an already-signed-in client. */
export async function clientSetPin(deviceId: string, pin: string, label: string) {
  const { data: sess } = await clientSupabase.auth.getSession();
  const { supabaseUrl, supabaseAnonKey } = getEnv();
  const res = await fetch(`${supabaseUrl}/functions/v1/client-pin-set`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
      Apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ device_id: deviceId, pin, device_label: label }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data } as FnResult;
}

/* ------------------------- New client sign-up ----------------------------- */
/*
 * Opening an account, in the same three steps as the website's /onboarding page
 * and against the same four edge functions. Nothing here is app-specific.
 *
 * The order is deliberate and worth preserving: the PAN is verified FIRST, and
 * what comes back is the name as it appears against that PAN. So the name on
 * the account is the registrar's, not one someone typed — which is what stops a
 * KYC mismatch surfacing weeks later, when it is expensive to fix.
 *
 * The code is emailed, not texted, despite `public-onboard-send-otp` taking a
 * `phone`: the phone identifies the pending signup, the email receives the code.
 */

export interface PanVerifyResult {
  valid?: boolean;
  name_as_per_pan?: string;
  already_registered?: boolean;
  error?: string;
}

/** Step 1 — confirm the PAN exists and read the registrar's name for it. */
export function signupVerifyPan(pan: string) {
  return callPublicFn<PanVerifyResult>('public-onboard-pan-verify', { pan });
}

/** Step 2 — create the free account and trigger the code. */
export function signupStart(input: {
  full_name: string;
  pan: string;
  phone: string;
  email: string;
}) {
  return callPublicFn<{ email_masked: string; already_exists?: boolean }>(
    'public-onboard-start',
    input,
  );
}

/** Resend, keyed by the phone that identifies the pending signup. */
export function signupResendOtp(phone: string) {
  return callPublicFn('public-onboard-send-otp', { phone });
}

/** Step 3 — verify the code and turn it into a real session. */
export async function signupVerifyOtp(phone: string, otp: string): Promise<SignInOutcome> {
  const { ok, data } = await callPublicFn<{ token_hash: string; client_id: string }>(
    'public-onboard-verify-otp',
    { phone, otp },
  );
  if (!ok || !data?.token_hash) return { ok: false, error: data?.error || 'Verification failed.' };

  const { error } = await clientSupabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'email',
  });
  if (error) return { ok: false, error: 'Could not sign you in. Please try again.' };

  /*
   * A brand-new account has no password at all, so there is nothing to force a
   * change of — `passwordChanged: true` here means "do not send them to the
   * change-password screen", not "they have set a password". They set one later
   * from Profile; until then the emailed code is how they get back in.
   */
  return { ok: true, id: data.client_id, passwordChanged: true };
}

/* --------------------- "Become a partner" enquiry -------------------------- */

/**
 * Records someone's interest in becoming a distribution partner.
 *
 * Not a signup: a DSA login is provisioned by a relationship manager after an
 * agreement, so there is nothing here that could create one. What this does is
 * put a lead in the CRM's ADMIN POOL, where an admin picks it up and assigns
 * it — which is the same queue every other unassigned lead lands in.
 *
 * A `duplicate` response is a success, not a failure: the mobile is already in
 * the CRM, so someone is already on it. The screen says the same thing either
 * way, because a distinct answer would let anyone use this to test whether a
 * given number is in Niyom's system.
 */
export function submitPartnerEnquiry(input: {
  full_name: string;
  mobile: string;
  email?: string;
  city?: string;
  arn?: string;
  remarks?: string;
}) {
  return callPublicFn<{ success: boolean; lead_code?: string; duplicate?: boolean }>(
    'public-partner-enquiry',
    input,
  );
}

/* ------------------------------- Partner --------------------------------- */

export interface PartnerIdentityLookup {
  dsa_id: string;
  dsa_email: string;
  password_changed: boolean;
}

export async function partnerSignIn(pan: string, password: string): Promise<SignInOutcome> {
  const { ok, data } = await callPublicFn<PartnerIdentityLookup>('partner-pan-login', { pan });
  if (!ok || !data?.dsa_email) return { ok: false, error: 'Invalid PAN or password.' };

  const { data: signIn, error } = await partnerSupabase.auth.signInWithPassword({
    email: data.dsa_email,
    password,
  });
  if (error || !signIn?.user) return { ok: false, error: 'Invalid PAN or password.' };

  return { ok: true, id: data.dsa_id, passwordChanged: data.password_changed };
}

export async function partnerPinSignIn(
  deviceId: string,
  dsaId: string,
  pin: string,
): Promise<SignInOutcome & { code?: string }> {
  const { ok, data } = await callPublicFn<{
    token_hash: string;
    dsa_id: string;
    password_changed: boolean;
  }>('partner-pin-login', { device_id: deviceId, dsa_id: dsaId, pin });

  if (!ok || !data?.token_hash) {
    return {
      ok: false,
      error: data?.error || 'That PIN didn’t work. Please try again.',
      code: data?.code,
    };
  }

  const { error } = await partnerSupabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'email',
  });
  if (error) return { ok: false, error: 'Could not sign you in. Please try again.' };

  return { ok: true, id: data.dsa_id, passwordChanged: data.password_changed !== false };
}

export const partnerReset = {
  sendCode: (pan: string) => callPublicFn('send-partner-reset-otp', { pan }),
  verifyCode: (pan: string, otp: string) =>
    callPublicFn<{ verified: boolean }>('reset-partner-password-with-otp', {
      action: 'verify',
      pan,
      otp,
    }),
  setPassword: (pan: string, otp: string, password: string) =>
    callPublicFn('reset-partner-password-with-otp', { action: 'reset', pan, otp, password }),
};

export async function partnerSetPin(deviceId: string, pin: string, label: string) {
  const { data: sess } = await partnerSupabase.auth.getSession();
  const { supabaseUrl, supabaseAnonKey } = getEnv();
  const res = await fetch(`${supabaseUrl}/functions/v1/partner-pin-set`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
      Apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ device_id: deviceId, pin, device_label: label }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data } as FnResult;
}
