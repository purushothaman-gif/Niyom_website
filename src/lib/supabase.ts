import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase credentials');
}

// Employee / CRM auth session — DEFAULT storage key. Left unchanged so existing
// staff logins keep working. Used by CRM, MF Admin, and public/anon pages.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
    /*
     * Google sign-in makes the three-instances-one-origin problem sharper.
     *
     * With the implicit flow the provider returns the access token in the URL
     * fragment, and EVERY Supabase instance on the page with detectSessionInUrl
     * would race to consume it — a client's token could land in the employee
     * instance's storage slot. PKCE returns a one-time `code` that is worthless
     * without the verifier held in THIS instance's storage, so only this client
     * can complete the exchange.
     *
     * detectSessionInUrl is off for the same reason: the exchange happens where
     * we choose (ClientAuthCallback), not implicitly wherever a URL is seen.
     * Nothing else here needs it — the OTP sign-ins use verifyOtp with a
     * server-issued token_hash, which is flow-agnostic.
     */
    flowType: 'pkce',
    detectSessionInUrl: false,
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
  },
});
