/**
 * The Supabase project's public coordinates, without the platform's syntax.
 * -----------------------------------------------------------------------------
 * The website reads these from `import.meta.env.VITE_*` — Vite-only syntax that
 * Hermes cannot even parse, so a shared file containing it would break the app
 * at bundle time rather than at runtime. The app reads `process.env.EXPO_PUBLIC_*`.
 *
 * Both point at the SAME project. This is only the URL and the publishable anon
 * key, which ship inside every client anyway; nothing secret passes through here.
 */

export interface NiyomEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /**
   * The whitelisted BSE proxy — the droplet that holds the BSE member
   * credentials. Undefined falls back to the production proxy; the literal
   * string 'none' switches the order rail off entirely.
   */
  bseProxyUrl?: string;
  /** 'mock' shows illustrative funds; anything else uses the real rail. */
  bseMode?: string;
}

/** Where the NIYOM proxy runs. Not a secret — it ships in every client. */
const DEFAULT_BSE_PROXY = 'https://api.niyomwealth.com';

/**
 * The BSE proxy origin, or null when the rail is deliberately switched off.
 * Shared by the three services that reach the droplet directly, so they cannot
 * disagree about the default.
 */
export function bseProxyBaseUrl(): string | null {
  const configured = getEnv().bseProxyUrl?.trim();
  if (configured?.toLowerCase() === 'none') return null;
  return (configured || DEFAULT_BSE_PROXY).replace(/\/$/, '');
}

let env: NiyomEnv | null = null;

/** Called once at platform startup, before any service runs. */
export function registerEnv(next: NiyomEnv): void {
  env = next;
}

export function getEnv(): NiyomEnv {
  if (!env) {
    throw new Error(
      'Niyom environment not registered. The platform entry point must call ' +
        'registerEnv() before any service runs.',
    );
  }
  return env;
}

/** Convenience for the many `${SUPABASE_URL}/functions/v1/x` call sites. */
export function functionUrl(name: string): string {
  return `${getEnv().supabaseUrl}/functions/v1/${name}`;
}

/** The headers every unauthenticated edge-function call needs. */
export function anonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Apikey: getEnv().supabaseAnonKey,
  };
}
