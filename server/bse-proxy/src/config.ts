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
  /** Comma-separated browser origins allowed to call this proxy. */
  allowedOrigins: string[];
  /** Supabase project URL + anon key — used to verify the caller's JWT. */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Supabase service-role key — enables webhook persistence (optional). */
  supabaseServiceRoleKey: string | null;
  /** Optional allowlist of BSE webhook source IPs. Empty = allow all. */
  webhookAllowedIps: string[];
  /** Set false only for local smoke tests. */
  requireAuth: boolean;
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
    requireAuth: process.env.REQUIRE_AUTH !== 'false',
  };
}
