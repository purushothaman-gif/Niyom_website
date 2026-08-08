/**
 * CasImportService — importing a client's own Consolidated Account Statement.
 *
 * Nothing to do with BSE, despite sharing its host: BSE is the order rail and
 * knows only what a client bought through us. A CAS is the whole picture,
 * including funds bought elsewhere, which is why importing one is the only way
 * a portfolio screen can be complete.
 *
 * The statement goes straight to the `cas-import` Edge Function and is never
 * stored anywhere in between — not in the browser, not in Supabase storage. It
 * is parsed in memory, the extracted rows are kept, and the file is discarded.
 *
 * It used to go to the BSE droplet. That box exists for a whitelisted static IP
 * which BSE StAR MF and the Cashfree relay need and parsing a PDF does not, so
 * the droplet is now only the order rail.
 *
 * Reading back is a plain Supabase query: RLS on cas_imports already limits a
 * client to their own, so there is no server round trip to justify.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { edgeFunctionErrorMessage } from '../../lib/edgeFunctionError';

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
  /** Where the statement's history starts — shown so two files are tellable apart. */
  statement_from: string | null;
  scheme_count: number | null;
  transaction_count: number | null;
  parsed_total: number | null;
}

export type CasImportResponse =
  | { ok: true; outcome: CasImportOutcome }
  | { ok: false; error: string };

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
  async importStatement(
    file: File,
    password: string,
    /** Links the import back to the tracked request that produced it, when there is one. */
    requestId?: string | null,
  ): Promise<CasImportResponse> {
    if (file.size > MAX_CAS_BYTES) {
      return { ok: false, error: 'That file is larger than 6 MB. Please upload the CAS as the registrar emailed it.' };
    }

    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) {
      return { ok: false, error: 'Your session has expired. Please sign in again.' };
    }

    try {
      /*
       * invoke() attaches the client's own session token, and the function reads
       * the client id from THAT rather than from the body — a forged clientId
       * cannot attach someone else's statement to another portfolio.
       */
      const { data: outcome, error } = await supabase.functions.invoke('cas-import', {
        body: {
          fileBase64: await toBase64(file),
          fileName: file.name,
          password,
          ...(requestId ? { requestId } : {}),
        },
      });

      if (error) {
        /*
         * A non-2xx arrives as a FunctionsHttpError carrying the Response, and
         * the message the client needs is inside its body — "that password did
         * not open the statement", "this statement belongs to a different PAN".
         * Reporting error.message instead would replace every one of them with
         * "Edge Function returned a non-2xx status code".
         */
        return {
          ok: false,
          error: await edgeFunctionErrorMessage(
            error, null,
            'We could not read that statement. Please try again.',
            { allowLibraryMessage: false },
          ),
        };
      }

      return { ok: true, outcome: outcome as CasImportOutcome };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection and try again.' };
    }
  },

  /** Statements this client has already imported, newest first. */
  async listImports(): Promise<CasImportRecord[]> {
    const { data, error } = await supabase
      .from('cas_imports')
      .select('id,status,created_at,statement_to,statement_from,scheme_count,transaction_count,parsed_total')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) return [];
    return (data ?? []) as CasImportRecord[];
  },

  /**
   * Remove a statement from the portfolio.
   *
   * Necessary because statements now COMBINE: uploading the right file no
   * longer corrects a wrong one, it sits alongside it. Deleting the import row
   * is the whole operation — folios, schemes and transactions cascade from it.
   *
   * RLS decides whether the caller may: a client can only reach their own rows,
   * and the grant is delete-only, so nothing about an imported figure can be
   * edited from a browser. The statement FILE was never stored, so this cannot
   * be undone by us — the client re-uploads their copy.
   */
  async removeImport(importId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await supabase.from('cas_imports').delete().eq('id', importId);
    return error
      ? { ok: false, error: 'That statement could not be removed. Please try again.' }
      : { ok: true };
  },
};
