/**
 * Proxy configuration — everything comes from environment variables so the
 * droplet's .env (never committed) is the single place secrets live.
 */

const BSE_BASES = {
  demo: 'https://starmfv2demo.bseindia.com/api',
  prod: 'https://v2.bsestarmf.in/api',
} as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export interface ProxyConfig {
  port: number;
  bseBaseUrl: string;
  bseEnv: 'demo' | 'prod';
  bseUsername: string;
  bsePassword: string;
  /** NIYOM's BSE member code — stamped into order/SXP payloads. */
  bseMemberCode: string;
  /**
   * X-API-Org-ID, required by BSE PRODUCTION on every authenticated call
   * (demo does not ask for it). Format `member/<code>:<base64 SHA-256 of our
   * SPKI DER public key>`. Omitting it returns errcode `invalid_org_header`;
   * sending a well-formed value for a key BSE has not registered for this
   * environment returns `org_key_not_found`.
   */
  bseOrgId: string | null;
  /**
   * Encrypt request payloads with JOSE (spec §6.1.7). Production mandates it;
   * demo accepts plain JSON, which is why this is switchable rather than
   * always-on — it lets the same build talk to both.
   */
  bseJose: boolean;
  /** Our private key — signs requests, decrypts responses. Never leaves the box. */
  bseJosePrivateKeyPath: string;
  /** BSE's public key — encrypts to them, verifies their responses. */
  bseJoseRemoteKeyPath: string;
  /**
   * EUIN used when the caller has none: an employee without an EUIN, or a
   * client placing their own order from the portal. SEBI expects an EUIN on
   * distributor-executed transactions, so there is always one.
   */
  bseDefaultEuin: string;
  /** Comma-separated browser origins allowed to call this proxy. */
  allowedOrigins: string[];
  /** Supabase project URL + anon key — used to verify the caller's JWT. */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Supabase service-role key — enables webhook persistence (optional). */
  supabaseServiceRoleKey: string | null;
  /** Optional allowlist of BSE webhook source IPs. Empty = allow all. */
  webhookAllowedIps: string[];
  /**
   * Emit a per-call transcript of BSE traffic to stdout, for UAT evidence.
   * Off in normal operation; see BseClient.transcribe.
   */
  bseTranscript: boolean;
  /** Set false only for local smoke tests. */
  requireAuth: boolean;
  /** Public origin of this proxy, for showing the webhook URL in diagnostics. */
  publicBaseUrl: string | null;
  /* --- Cashfree Verification relay (PAN). This droplet's static IP is what
   * Cashfree whitelists; the /verify/pan route forwards to Cashfree from here.
   * The Supabase edge function calls it with x-relay-secret. All optional so
   * the proxy still boots if verification isn't configured yet. */
  /**
   * Shared secret for the nightly NAV refresh. The droplet's own cron calls the
   * route with it, so the job needs no Supabase session of its own.
   */
  navRefreshSecret: string | null;
  panRelaySecret: string | null;
  cashfreeVerifyClientId: string | null;
  cashfreeVerifySecret: string | null;
  cashfreeVerifyEnv: 'production' | 'sandbox';
}

export function loadConfig(): ProxyConfig {
  const bseEnv = (process.env.BSE_ENV === 'prod' ? 'prod' : 'demo') as 'demo' | 'prod';
  return {
    port: Number(process.env.PORT || 8080),
    bseEnv,
    bseBaseUrl: process.env.BSE_BASE_URL || BSE_BASES[bseEnv],
    bseUsername: required('BSE_USERNAME'),
    bsePassword: required('BSE_PASSWORD'),
    bseMemberCode: required('BSE_MEMBER_CODE'),
    bseOrgId: process.env.BSE_ORG_ID || null,
    bseJose: process.env.BSE_JOSE === 'true',
    bseJosePrivateKeyPath:
      process.env.BSE_JOSE_PRIVATE_KEY || '/home/niyom/bse-keys/bse_jose_private.pem',
    bseJoseRemoteKeyPath:
      process.env.BSE_JOSE_REMOTE_KEY || '/home/niyom/bse-keys/bse_public_demo_prod.pem',
    bseDefaultEuin: process.env.BSE_DEFAULT_EUIN || 'E124361',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    supabaseUrl: required('SUPABASE_URL'),
    supabaseAnonKey: required('SUPABASE_ANON_KEY'),
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
    webhookAllowedIps: (process.env.WEBHOOK_ALLOWED_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    bseTranscript: process.env.BSE_TRANSCRIPT === 'true',
    requireAuth: process.env.REQUIRE_AUTH !== 'false',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://api.niyomwealth.com',
    navRefreshSecret: process.env.NAV_REFRESH_SECRET || null,
    panRelaySecret: process.env.PAN_RELAY_SECRET || null,
    cashfreeVerifyClientId: process.env.CASHFREE_VERIFY_CLIENT_ID || null,
    cashfreeVerifySecret: process.env.CASHFREE_VERIFY_SECRET_KEY || null,
    cashfreeVerifyEnv: (process.env.CASHFREE_VERIFY_ENV === 'sandbox' ? 'sandbox' : 'production'),
  };
}
