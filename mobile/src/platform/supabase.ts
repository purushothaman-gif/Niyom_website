/**
 * The app's Supabase clients, and the one place they are handed to `shared/`.
 * -----------------------------------------------------------------------------
 * Same project, same anon key, same tables and same edge functions as
 * niyomwealth.com — this file only differs from `src/lib/supabase.ts` in the two
 * places a phone differs from a browser: where the config comes from
 * (`process.env.EXPO_PUBLIC_*` rather than Vite's `import.meta.env`) and where
 * the session is kept (the device keychain rather than localStorage).
 *
 * ## Three clients, not one, for the same reason as the website
 *
 * A client and a partner can both have signed in on one handset. Supabase keys
 * its stored session by `storageKey`, so a single client would have the second
 * sign-in overwrite the first — and the damage is not "logged out", it is
 * running a partner's RPCs with a client's token, where `nw_current_dsa_id()`
 * returns NULL and every call raises "Partner access required". Separate keys
 * keep the two sessions side by side, so switching surfaces does not mean
 * signing in again.
 *
 * `detectSessionInUrl` is off on all three: an app has no URL to adopt a session
 * from, and Niyom's client password recovery uses a 6-digit code rather than an
 * email link, so nothing here depends on it.
 */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@shared/lib/database.types';
import { registerDb } from '@shared/platform/db';
import { registerEnv } from '@shared/platform/env';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { registerFileWriter } from '@shared/platform/fileWriter';
import { secureStorage } from './secureStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase credentials. Copy mobile/.env.example to mobile/.env ' +
      'and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

function makeClient(storageKey: string) {
  return createClient<Database>(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      storageKey,
      storage: secureStorage,
      persistSession: true,
      /*
       * The library's own timer keeps the access token fresh while the app is
       * open. It is paused and resumed with the app's foreground state in
       * app/_layout.tsx — left running in the background it fires against a
       * suspended network stack and burns the refresh token for nothing.
       */
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

/** Employee / public-anon reads. The app has no CRM, so this is anon only. */
export const supabase = makeClient('nw-app-default-auth');
/** The client Wealth Portal. */
export const clientSupabase = makeClient('nw-app-client-auth');
/** The partner (DSA) portal. */
export const partnerSupabase = makeClient('nw-app-partner-auth');

/*
 * Hand them to shared/, which holds the portfolio, CAS, gains and partner logic
 * this app runs in common with the website. Done at module scope, and this
 * module is imported by the root layout before any screen mounts, so no service
 * can run before its client exists.
 */
registerEnv({
  supabaseUrl,
  supabaseAnonKey,
  bseProxyUrl: process.env.EXPO_PUBLIC_BSE_PROXY_URL,
  bseMode: process.env.EXPO_PUBLIC_BSE_MODE,
});
registerDb('default', supabase);
registerDb('client', clientSupabase);
registerDb('partner', partnerSupabase);

/*
 * The partner demo flag keeps shared/'s default in-memory store: on the website
 * that flag lives in sessionStorage and dies with the tab, and in an app "dies
 * with the process" is the same promise. Nothing to register.
 */

/*
 * Delivering a generated report. A phone has no downloads folder, so the file is
 * written to the app's cache and handed to the system share sheet — the person
 * chooses Files, Mail or WhatsApp. Cache rather than documents on purpose: the
 * OS may reclaim it, and a report can always be exported again.
 */
registerFileWriter(async ({ fileName, base64, mimeType }) => {
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  target.create();
  // Written as base64 rather than decoded here: `Uint8Array.fromBase64` is very
  // new and not in Hermes, and expo-file-system decodes natively anyway.
  target.write(base64, { encoding: 'base64' });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target.uri, {
      mimeType,
      dialogTitle: fileName,
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  }
});
