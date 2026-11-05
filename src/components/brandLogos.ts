// Name-keyed logo lookup for mutual-fund AMCs and bond issuers (nw_brand_logos).
//
// The table is tiny (one row per fund house / issuer) and readable by anon, so it
// is fetched ONCE per page load with a plain REST call — no auth client involved.
// That matters: the CRM, client portal and partner portal each use a different
// Supabase client (separate session slots), and a logo must render identically
// on all three plus the unauthenticated /bond-offer page.

import { useSyncExternalStore } from 'react';

export type BrandKind = 'amc' | 'bond_issuer';

/** Must match the generated name_key column: lower-case, alphanumerics only. */
export function brandKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type LogoMap = Map<string, string>; // `${kind}:${name_key}` → url

let map: LogoMap = new Map();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function loadBrandLogos(force = false): Promise<void> {
  if (loading && !force) return loading;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  loading = fetch(`${url}/rest/v1/nw_brand_logos?select=kind,name_key,logo_url`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: { kind: string; name_key: string; logo_url: string }[]) => {
      const next: LogoMap = new Map();
      for (const r of rows) if (r.logo_url) next.set(`${r.kind}:${r.name_key}`, r.logo_url);
      map = next;
      emit();
    })
    // A logo is decoration: on failure every caller falls back to its monogram.
    .catch(() => {});
  return loading;
}

function subscribe(l: () => void) {
  listeners.add(l);
  void loadBrandLogos();
  return () => listeners.delete(l);
}

/** The logo URL for a fund house / issuer, or null while loading or if none. */
export function useBrandLogo(kind: BrandKind, name: string | null | undefined): string | null {
  const m = useSyncExternalStore(subscribe, () => map);
  if (!name) return null;
  return m.get(`${kind}:${brandKey(name)}`) ?? null;
}

/** Whole map, for the admin page. */
export function useBrandLogoMap(): LogoMap {
  return useSyncExternalStore(subscribe, () => map);
}
