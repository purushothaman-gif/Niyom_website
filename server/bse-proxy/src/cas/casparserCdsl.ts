/**
 * CDSL eCAS retrieval + parsing through CASParser.
 *
 * Two outbound steps, both needing the vendor key the droplet holds:
 *   1. /v4/cdsl/fetch         — PAN + BO id + DOB, sends the investor an OTP
 *   2. /v4/cdsl/fetch/:id/verify — the OTP, returns eCAS PDF download URLs
 * then /v4/smart/parse on the latest PDF turns it into holdings.
 *
 * A CDSL eCAS covers BOTH depositories, but ONLY when CDSL is the investor's
 * first demat account — then CDSL issues the consolidated statement and it
 * includes their NSDL holdings too. An NSDL-first investor's statement is issued
 * by NSDL, which CASParser cannot OTP-fetch, so those clients import by email
 * instead (demat.ts routes them there). It is a holdings SNAPSHOT, not a
 * ledger — there are no transactions to map.
 *
 * Off unless CASPARSER_API_KEY is set. The PAN doubles as the PDF password
 * (CDSL eCAS is PAN-locked) and is never stored or logged here.
 */
import type { ProxyConfig } from '../config.js';
import { CasError } from './db.js';

const BASE = 'https://api.casparser.in';
const FETCH_TIMEOUT_MS = 55_000; // step 1 solves a captcha vendor-side (~15-20s)
const PARSE_TIMEOUT_MS = 30_000;

export const dematFetchEnabled = (cfg: ProxyConfig): boolean => Boolean(cfg.casparserApiKey);

async function vendorPost(
  cfg: ProxyConfig,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!cfg.casparserApiKey) throw new CasError('Demat import is not enabled.', 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let status = 0;
  let json: Record<string, unknown> = {};
  try {
    const res = await fetchImpl(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.casparserApiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = res.status;
    json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    console.error('[cas/demat] unreachable', path, err instanceof Error ? err.name : 'error');
    throw new CasError('We could not reach the demat service just now. Please try again.', 502);
  } finally {
    clearTimeout(timer);
  }

  if (status >= 200 && status < 300 && String(json.status ?? 'success').toLowerCase() !== 'failed') {
    return json;
  }
  // Vendor message is for an integrator; never forward it to a client.
  console.error('[cas/demat] rejected', path, status, String(json.msg ?? json.message ?? '').slice(0, 300));
  if (status === 402) throw new CasError('Demat import is temporarily unavailable. Please try later.', 502);
  if (status >= 400 && status < 500 && ![401, 403, 429].includes(status)) {
    throw new CasError('The depository did not accept these details. Please check the demat account and date of birth on file.', 400);
  }
  throw new CasError('We could not complete the demat import just now. Please try again.', 502);
}

/** Step 1: request the OTP. Returns the vendor session id to carry into verify. */
export async function cdslFetchStart(
  cfg: ProxyConfig,
  args: { pan: string; boId: string; dob: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ sessionId: string }> {
  const json = await vendorPost(
    cfg,
    '/v4/cdsl/fetch',
    { pan: args.pan, bo_id: args.boId, dob: args.dob },
    FETCH_TIMEOUT_MS,
    fetchImpl,
  );
  const sessionId = String(json.session_id ?? '');
  if (!sessionId) throw new CasError('The depository did not start a session. Please try again.', 502);
  return { sessionId };
}

export interface CdslFile {
  filename: string;
  url: string;
}

/** Step 2: verify the OTP, get the eCAS PDF URLs (newest first). */
export async function cdslFetchVerify(
  cfg: ProxyConfig,
  sessionId: string,
  otp: string,
  numPeriods = 1,
  fetchImpl: typeof fetch = fetch,
): Promise<CdslFile[]> {
  const json = await vendorPost(
    cfg,
    `/v4/cdsl/fetch/${encodeURIComponent(sessionId)}/verify`,
    { otp, num_periods: numPeriods },
    FETCH_TIMEOUT_MS,
    fetchImpl,
  );
  const files = Array.isArray(json.files) ? (json.files as CdslFile[]) : [];
  if (files.length === 0) throw new CasError('No demat statement came back. Please re-enter the OTP.', 502);
  return files;
}

/** Parse one eCAS PDF by URL. `password` is the investor's PAN. */
export async function smartParseUrl(
  cfg: ProxyConfig,
  url: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedCas> {
  const json = await vendorPost(
    cfg,
    '/v4/smart/parse',
    { pdf_url: url, password },
    PARSE_TIMEOUT_MS,
    fetchImpl,
  );
  return json as unknown as ParsedCas;
}

/* --------------------------- parse → demat rows --------------------------- */

/** Only the slice of CASParser's parse JSON we rely on. */
export interface ParsedCas {
  meta?: { cas_type?: string; statement_period?: { to?: string } };
  investor?: { name?: string; pan?: string };
  summary?: { total_value?: number };
  demat_accounts?: Array<{
    demat_type?: string;
    dp_id?: string;
    dp_name?: string;
    client_id?: string;
    bo_id?: string;
    value?: number;
    holdings?: Record<string, Array<Record<string, unknown>>>;
  }>;
  nps?: Array<Record<string, unknown>>;
}

export type DematAssetClass =
  | 'equity'
  | 'corporate_bond'
  | 'gsec'
  | 'aif'
  | 'nps'
  | 'etf'
  | 'demat_mf'
  | 'other';

/** Which holdings bucket in the parse JSON maps to which stored asset class. */
const BUCKET_CLASS: Record<string, DematAssetClass> = {
  equities: 'equity',
  corporate_bonds: 'corporate_bond',
  government_securities: 'gsec',
  aifs: 'aif',
  etfs: 'etf',
  demat_mutual_funds: 'demat_mf',
};

export interface MappedHolding {
  assetClass: DematAssetClass;
  isin: string | null;
  name: string;
  units: number | null;
  value: number | null;
  extra: Record<string, unknown>;
}

export interface MappedAccount {
  depository: string | null;
  dpId: string | null;
  dpName: string | null;
  boId: string | null;
  value: number | null;
  holdings: MappedHolding[];
}

export interface MappedCas {
  casType: string | null;
  statementDate: string | null;
  investorName: string | null;
  investorPan: string | null;
  totalValue: number | null;
  accounts: MappedAccount[];
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : v == null ? null : Number(v) || null;
const str = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

function mapHolding(assetClass: DematAssetClass, h: Record<string, unknown>): MappedHolding {
  const name = str(h.name ?? h.scheme ?? h.issuer ?? h.isin) ?? 'Unknown holding';
  const isin = str(h.isin);
  const units = num(h.units ?? h.quantity ?? h.balance);
  const value = num(h.value ?? h.market_value ?? h.amount);
  // Keep everything the statement carried that we did not lift into a column,
  // so coupon/maturity/PRAN are available without a schema change per class.
  const known = new Set(['name', 'scheme', 'issuer', 'isin', 'units', 'quantity', 'balance', 'value', 'market_value', 'amount']);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h)) if (!known.has(k) && v != null) extra[k] = v;
  return { assetClass, isin, name, units, value, extra };
}

/**
 * Flatten CASParser's parse JSON into the rows demat_* stores.
 *
 * Unknown holding buckets are kept under asset_class 'other' rather than
 * dropped — a client's statement showing a value we silently discard is worse
 * than one labelled only by its ISIN.
 */
export function mapParseToDemat(parse: ParsedCas): MappedCas {
  const accounts: MappedAccount[] = (parse.demat_accounts ?? []).map((acc) => {
    const holdings: MappedHolding[] = [];
    for (const [bucket, items] of Object.entries(acc.holdings ?? {})) {
      const cls = BUCKET_CLASS[bucket] ?? 'other';
      for (const item of items ?? []) holdings.push(mapHolding(cls, item));
    }
    return {
      depository: str(acc.demat_type),
      dpId: str(acc.dp_id),
      dpName: str(acc.dp_name),
      boId: str(acc.bo_id ?? acc.client_id),
      value: num(acc.value),
      holdings,
    };
  });

  // NPS sits at the top level, not under a demat account; give it its own
  // synthetic account so it still reaches the board.
  const npsHoldings = (parse.nps ?? []).map((n) => mapHolding('nps', n));
  if (npsHoldings.length) {
    accounts.push({ depository: 'NPS', dpId: null, dpName: 'NPS', boId: null, value: null, holdings: npsHoldings });
  }

  return {
    casType: str(parse.meta?.cas_type),
    statementDate: str(parse.meta?.statement_period?.to),
    investorName: str(parse.investor?.name),
    investorPan: str(parse.investor?.pan),
    totalValue: num(parse.summary?.total_value),
    accounts,
  };
}

/* ------------------------------- persistence ------------------------------ */

import { randomUUID } from 'node:crypto';
import { sbInsert, sbSelect } from './db.js';

export interface StoreResult {
  importId: string;
  duplicate: boolean;
  holdings: number;
  byClass: Record<string, number>;
  totalValue: number | null;
  statementDate: string | null;
}

/**
 * Write a parsed eCAS into the demat_* tables.
 *
 * Shared by the OTP route and inbox sync so both store identically. Re-importing
 * the same snapshot (same client, depository and statement date) is a no-op.
 * demat_mf is still excluded upstream in mapParseToDemat.
 */
export async function storeDematParse(
  cfg: ProxyConfig,
  args: { clientId: string; pan: string | null; mapped: MappedCas; source: string; createdBy?: string | null },
): Promise<StoreResult> {
  const { clientId, mapped, source } = args;
  const totalValue = mapped.totalValue;
  const statementDate = mapped.statementDate;

  if (statementDate && mapped.casType) {
    const [dupe] = await sbSelect<{ id: string }>(
      cfg,
      `demat_imports?select=id&client_id=eq.${encodeURIComponent(clientId)}` +
        `&cas_type=eq.${encodeURIComponent(mapped.casType)}` +
        `&statement_date=eq.${encodeURIComponent(statementDate)}&status=eq.parsed&limit=1`,
    );
    if (dupe) return { importId: dupe.id, duplicate: true, holdings: 0, byClass: {}, totalValue, statementDate };
  }

  const importId = randomUUID();
  const holdingCount = mapped.accounts.reduce((n, a) => n + a.holdings.length, 0);

  await sbInsert(cfg, 'demat_imports', [
    {
      id: importId,
      client_id: clientId,
      investor_pan: mapped.investorPan ?? args.pan,
      investor_name: mapped.investorName,
      source,
      cas_type: mapped.casType,
      statement_date: statementDate,
      status: 'parsed',
      total_value: totalValue,
      account_count: mapped.accounts.length,
      holding_count: holdingCount,
      created_by: args.createdBy ?? null,
    },
  ]);

  const accountRows: Record<string, unknown>[] = [];
  const holdingRows: Record<string, unknown>[] = [];
  const byClass: Record<string, number> = {};
  for (const acc of mapped.accounts) {
    const accountId = randomUUID();
    accountRows.push({
      id: accountId,
      import_id: importId,
      client_id: clientId,
      depository: acc.depository,
      dp_id: acc.dpId,
      dp_name: acc.dpName,
      bo_id: acc.boId,
      value: acc.value,
    });
    for (const h of acc.holdings) {
      byClass[h.assetClass] = (byClass[h.assetClass] ?? 0) + 1;
      holdingRows.push({
        id: randomUUID(),
        import_id: importId,
        account_id: accountId,
        client_id: clientId,
        asset_class: h.assetClass,
        isin: h.isin,
        name: h.name,
        units: h.units,
        value: h.value,
        extra: h.extra,
      });
    }
  }
  await sbInsert(cfg, 'demat_accounts', accountRows);
  await sbInsert(cfg, 'demat_holdings', holdingRows);

  return { importId, duplicate: false, holdings: holdingCount, byClass, totalValue, statementDate };
}
