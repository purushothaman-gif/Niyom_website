// Fund catalog read for the CRM.
//
// WHY THIS EXISTS RATHER THAN REUSING MfCatalogService
// The portal's service imports `clientSupabase` — the client-portal auth
// instance, which is the only client in the app configured with
// detectSessionInUrl: true and carries its own storage key. Importing it into
// the CRM bundle instantiates a second GoTrue client alongside the employee
// one; the two then contend over auth state and the CRM fails to mount.
// The portal's session isolation is deliberate (see src/lib/supabase.ts), so
// the fix is for each surface to read through its own client, not to relax it.
//
// This reads the AMFI scheme universe (mf_scheme_cache) rather than the curated
// `mutual_funds` the portal shows — ~2,500 live schemes across 52 fund houses,
// against a hand-picked 36. Returns for both are computed by the same
// mfReturns.computeAll, so a fund on both screens shows the same numbers.

import { supabase } from '../../../lib/supabase';
import { listUniverseFunds as listUniverse } from '../../../lib/funds/universeCatalog';
import type { CatalogFund, CatalogNavPoint } from '../../../portal/types/funds';

/**
 * NAV history for one scheme, via the mf-detail edge function.
 *
 * Deliberately a bare fetch with the anon key rather than supabase.functions
 * .invoke(): it matches what the portal does, and it keeps this module free of
 * any auth client — the mistake that blanked the CRM was pulling an auth
 * instance across the portal/CRM boundary.
 *
 * Points come back oldest-first with dates as "dd-mm-yyyy" (mfapi's format),
 * roughly monthly over the scheme's life.
 */
export async function fetchNavHistory(amfiCode: string): Promise<{
  navHistory: CatalogNavPoint[];
  high52w: number | null;
  low52w: number | null;
}> {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${base}/functions/v1/mf-detail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}),
    },
    body: JSON.stringify({ code: amfiCode }),
  });
  if (!res.ok) throw new Error(`NAV history unavailable (${res.status})`);
  const json = (await res.json()) as {
    success?: boolean;
    error?: string;
    navHistory?: CatalogNavPoint[];
    metrics?: { high_52w?: number; low_52w?: number };
  };
  if (!json.success) throw new Error(json.error ?? 'NAV history unavailable');
  return {
    navHistory: json.navHistory ?? [],
    high52w: json.metrics?.high_52w ?? null,
    low52w: json.metrics?.low_52w ?? null,
  };
}

/** Delegates to the shared universe read, using the CRM's own auth client. */
export function listUniverseFunds(): Promise<CatalogFund[]> {
  return listUniverse(supabase);
}
