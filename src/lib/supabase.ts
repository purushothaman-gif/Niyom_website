import { createClient } from '@supabase/supabase-js';

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
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: false },
});

// Client-portal auth session — ISOLATED storage key. A client login and an
// employee (CRM) login share one browser origin; with a single client they
// overwrite each other's Supabase auth token (a CRM session then leaks into the
// portal as a non-client user → edge functions reject it 401 "Unauthorized").
// This second instance keeps the client's session in its own slot so both can
// coexist. EVERY client-portal path (auth + data + storage + edge functions)
// must use this instance so RLS and `is_client` checks run as the actual client.
export const clientSupabase = createClient(supabaseUrl, supabaseAnonKey, {
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
export const partnerSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'nw-partner-portal-auth',
    // Never adopt URL sessions (same reason as the default client above).
    detectSessionInUrl: false,
  },
});
