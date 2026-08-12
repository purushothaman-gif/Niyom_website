import { createClient } from '@supabase/supabase-js';
/*
 * The generated schema. Typing all three clients means every .from(), column
 * name, insert shape and return type in the app is checked against the real
 * database — the same thing that turned up a bond cashflow insert which had
 * been silently rejected since the day it was written.
 *
 * Regenerate after any migration: `npm run gen:types`
 */
import type { Database } from './database.types';
import { registerDb } from '../../shared/platform/db';
import { registerEnv } from '../../shared/platform/env';
import { registerEphemeralStore } from '../../shared/platform/ephemeralStore';
import { registerFileWriter } from '../../shared/platform/fileWriter';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase credentials');
}

// Employee / CRM auth session — DEFAULT storage key. Used by CRM, MF Admin, and
// public/anon pages. `detectSessionInUrl: false` is deliberate: the ONLY email
// link that produces a URL session in this app is the CLIENT password-recovery
// link, and that session must land in the client-portal slot — not here. With
// the default (true), whichever instance parsed the hash first would win, so a
// recovery token could adopt into the employee slot (see PartnerLogin's note),
// leaving the client reset dead in the water. No staff/admin flow relies on
// URL-session detection (all use signInWithPassword or verifyOtp token_hash).
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: false },
});

// Client-portal auth session — ISOLATED storage key. A client login and an
// employee (CRM) login share one browser origin; with a single client they
// overwrite each other's Supabase auth token (a CRM session then leaks into the
// portal as a non-client user → edge functions reject it 401 "Unauthorized").
// This second instance keeps the client's session in its own slot so both can
// coexist. EVERY client-portal path (auth + data + storage + edge functions)
// must use this instance so RLS and `is_client` checks run as the actual client.
export const clientSupabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'nw-client-portal-auth',
    // The sole instance that adopts an email-link (password-recovery) session,
    // so the recovery token always lands in the client slot. The reset screen
    // (/client-reset-password) reads it here to let the client set a new password.
    detectSessionInUrl: true,
  },
});

// Partner-portal (DSA) auth session — ISOLATED storage key, third of three.
// A staff member, a client and a partner can all be signed in on the same
// browser origin; each needs its own token slot or they overwrite one another
// (a CRM session leaking into the partner portal makes nw_current_dsa_id()
// return NULL, so every RPC raises "Partner access required"). EVERY partner
// path (auth + data + storage + edge functions) must use this instance.
export const partnerSupabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'nw-partner-portal-auth',
    // Never adopt URL sessions (same reason as the default client above).
    detectSessionInUrl: false,
  },
});

/* ---------------------------------------------------------------------------
 * Hand the three clients to shared/.
 *
 * The portfolio, CAS, gains and partner logic lives in `shared/` so this site
 * and the mobile app run ONE copy of it and can never show different numbers.
 * Those files cannot build a client themselves — they would have to choose
 * between Vite's `import.meta.env` and the app's `process.env`, and only one of
 * those parses on each platform. So the platform builds the clients and
 * registers them, and the shared code asks for one by surface.
 *
 * Registration happens at module scope, which is what makes it safe: every
 * shared service reaches its client through a lazy lookup, and this module is
 * imported before any of them can run.
 * ------------------------------------------------------------------------- */
registerEnv({
  supabaseUrl,
  supabaseAnonKey,
  bseProxyUrl: import.meta.env.VITE_BSE_PROXY_URL,
  bseMode: import.meta.env.VITE_BSE_MODE,
});
registerDb('default', supabase);
registerDb('client', clientSupabase);
registerDb('partner', partnerSupabase);
// The browser's own per-tab store, which is what the partner demo flag has
// always used. The app has no tab and keeps the default in-memory store.
registerEphemeralStore({
  get: (k) => sessionStorage.getItem(k),
  set: (k, v) => sessionStorage.setItem(k, v),
  remove: (k) => sessionStorage.removeItem(k),
});
/*
 * Delivering a generated report. A browser downloads it; the mobile app opens a
 * share sheet instead. Same spreadsheet either way — only the last step differs.
 */
registerFileWriter(async ({ fileName, base64, mimeType }) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick so the download has certainly started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
