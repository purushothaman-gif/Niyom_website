/**
 * CasImportService — importing a client's own Consolidated Account Statement.
 *
 * Nothing to do with BSE, despite sharing its host: BSE is the order rail and
 * knows only what a client bought through us. A CAS is the whole picture,
 * including funds bought elsewhere, which is why importing one is the only way
 * a portfolio screen can be complete.
 *
 * The statement is posted straight to the proxy and never stored anywhere in
 * between — not in the browser, not in Supabase storage. The proxy parses it in
 * memory, keeps the extracted rows, and discards the file.
 *
 * Reading back is a plain Supabase query: RLS on cas_imports already limits a
 * client to their own, so there is no server round trip to justify.
 */
import { clientSupabase as supabase } from '../../lib/supabase';

/** Mirrors the proxy's cap, so an oversized file fails here with a real message. */
export const MAX_CAS_BYTES = 6 * 1024 * 1024;

export interface CasImportOutcome {
  importId: string;
  /** reconciled = checked against the statement's own totals and trustworthy. */
  status: 'reconciled' | 'mismatch' | 'failed';
  duplicate: boolean;
  variant?: 'summary' | 'detailed';
  statementTo?: string | null;
  counts?: { folios: number; schemes: number; transactions: number };
  totals?: {
    statedMarketValue: number | null;
    parsedMarketValue: number;
    statedCostValue: number | null;
    parsedCostValue: number;
  };
  failures?: string[];
  warnings?: string[];
}

export interface CasImportRecord {
  id: string;
  status: string;
  created_at: string;
  statement_to: string | null;
  scheme_count: number | null;
  transaction_count: number | null;
  parsed_total: number | null;
}

export type CasImportResponse =
  | { ok: true; outcome: CasImportOutcome }
  | { ok: false; error: string };

function proxyBaseUrl(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const configured = env.VITE_BSE_PROXY_URL?.trim();
  if (configured?.toLowerCase() === 'none') return null;
  return (configured || 'https://api.niyomwealth.com').replace(/\/$/, '');
}

/**
 * btoa() takes a binary string, and spreading a multi-megabyte array into
 * String.fromCharCode in one call overflows the argument limit — hence chunks.
 */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export const CasImportService = {
  /**
   * Send a statement to be parsed and stored.
   *
   * The password is the one the investor chose on the CAMS request form — it is
   * NOT their PAN, which is the assumption that makes this fail most often. It
   * is used to open the PDF and is never persisted.
   */
  async importStatement(file: File, password: string): Promise<CasImportResponse> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return { ok: false, error: 'Portfolio import is not enabled here yet.' };
    if (file.size > MAX_CAS_BYTES) {
      return { ok: false, error: 'That file is larger than 6 MB. Please upload the CAS as the registrar emailed it.' };
    }

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: 'Your session has expired. Please sign in again.' };

    try {
      const res = await fetch(`${baseUrl}/cas/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fileBase64: await toBase64(file),
          fileName: file.name,
          password,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return {
          ok: false,
          error: (body.error as string) || 'We could not read that statement. Please try again.',
        };
      }
      return { ok: true, outcome: body as unknown as CasImportOutcome };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection and try again.' };
    }
  },

  /** Statements this client has already imported, newest first. */
  async listImports(): Promise<CasImportRecord[]> {
    const { data, error } = await supabase
      .from('cas_imports')
      .select('id,status,created_at,statement_to,scheme_count,transaction_count,parsed_total')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) return [];
    return (data ?? []) as CasImportRecord[];
  },
};
