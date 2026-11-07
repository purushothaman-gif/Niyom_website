// Shared ingest pipeline for the registrar mailback feeds. Both entry points —
// the admin manual upload (mf-rta-import) and the automated Apps Script push
// (mf-rta-ingest) — hand an encrypted ZIP to runImport, which decrypts it,
// detects the report (WBR9 holdings vs WBR49 SIPs), upserts the staging rows,
// matches folios/SIPs to clients by PAN, and writes one import-log row. Keeping
// this in one place is what stops the two endpoints drifting apart.
//
// The Supabase client is passed in (service role, RLS-bypassing) so this module
// stays free of env wiring. Result rows are cast rather than relying on the
// generated types, matching the rest of the edge functions.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { parseDbf, type DbfTable } from './dbf.ts';
import { parseCsv } from './csv.ts';
import { parseWbr9, type RtaFolioStage, type RtaHoldingStage } from './wbr9.ts';
import { parseWbr49, type RtaSipStage } from './wbr49.ts';
import { isWbr2, parseWbr2 } from './wbr2.ts';
import { isKfAum, isKfMaster, isKfSip, parseKfAum, parseKfMaster, parseKfSip } from './kfintech.ts';
import { isWbr22, isWbr53, parseWbr22, parseWbr53 } from './wbr53.ts';
import { isWbtrn, parseWbtrn } from './wbtrn.ts';
import type { RtaTxnStage } from './txns.ts';
import { isWbr77, parseWbr77 } from './wbr77.ts';
import { isWbr39, parseWbr39 } from './wbr39.ts';
import { unzipMember, WinzipError } from './winzip.ts';

/** A base64 body inflates by a third; the ZIPs are a few KB, cap well above. */
export const MAX_ZIP_BYTES = 8 * 1024 * 1024;

export class RtaError extends Error {
  status: number;
  /** For an unrecognised feed: its column layout (names only), logged for a future parser. */
  layout?: FeedLayout;
  constructor(message: string, status = 400, layout?: FeedLayout) {
    super(message);
    this.status = status;
    this.layout = layout;
  }
}

/**
 * The shape of a feed we could not recognise — column NAMES and counts only,
 * never a value, so it is safe to store in the (admin-readable) import log.
 * This is what lets a new CAMS/KFintech report be wired from the real file.
 */
// A type alias (not an interface) so it is assignable to the generated Json column type.
export type FeedLayout = {
  format: 'dbf' | 'csv';
  member: string;
  columns: string[];
  rows: number;
  declaredRows?: number;
};

export function dbfLayout(member: string, table: DbfTable): FeedLayout {
  return {
    format: 'dbf', member,
    columns: table.fields.map((f) => `${f.name}:${f.type}${f.length}`),
    rows: table.rows.length,
    declaredRows: table.declaredCount,
  };
}

export function csvLayout(member: string, header: string[], rows: number): FeedLayout {
  return { format: 'csv', member, columns: header.map((h) => h.trim()).filter(Boolean), rows };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type RtaReport =
  | 'WBR9' | 'WBR49' | 'WSREG' | 'WBCUM' | 'WBR2' | 'WBTRN' | 'WBR77' | 'WBR39'
  | 'WBR53' | 'WBR22' | 'WBMST';

/** Which report is this? Matched by column presence, not file name. */
export function detectReport(table: DbfTable): RtaReport | null {
  const names = new Set(table.fields.map((f) => f.name));
  // WBR77 first: it also carries FOLIO_NO + AUTO_AMOUN, which WBR49 keys on.
  if (isWbr77(table)) return 'WBR77';
  if (['FOLIOCHK', 'CLOS_BAL', 'SCH_NAME'].every((n) => names.has(n))) return 'WBR9';
  // Full-book holdings snapshots. WBR53 shares FOLIOCHK/CLOS_BAL with WBR9 but
  // has no SCH_NAME, so the WBR9 test above never claims it.
  if (isWbr53(table)) return 'WBR53';
  if (isWbr22(table)) return 'WBR22';
  if (isWbr39(table)) return 'WBR39';
  if (['FOLIO_NO', 'AUT_TRNTYP', 'AUTO_AMOUN'].every((n) => names.has(n))) return 'WBR49';
  if (isWbr2(table)) return 'WBR2';
  return null;
}

/** CAMS names the inner DBF "DDMMYYYYhhmmss_...": pull the generation date. */
export function snapshotFromName(name: string | null): string | null {
  const m = (name ?? '').match(/(\d{2})(\d{2})(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  if (mm < '01' || mm > '12' || dd < '01' || dd > '31' || yyyy < '2000') return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Open the WinZip-AES ZIP (DBF for CAMS, CSV for KFintech), mapping failures to a clear message. */
async function unzipFeed(data: Uint8Array, passwords: string[]): Promise<{ name: string; bytes: Uint8Array }> {
  // Try each candidate password. A registrar can use different passwords for
  // different reports (KFintech's SIP subscription vs its AUM report), so the
  // caller passes the likely ones in order and the first that opens wins.
  let pwFailed = false;
  for (const password of passwords) {
    try {
      return await unzipMember(data, password, /\.(dbf|csv)$/i);
    } catch (e) {
      if (e instanceof WinzipError) {
        if (e.message === 'WRONG_PASSWORD' || e.message === 'AUTH_FAILED') { pwFailed = true; continue; }
        throw new RtaError(e.message, 422);
      }
      throw e;
    }
  }
  if (pwFailed) throw new RtaError('Could not open the ZIP — none of the stored mailback passwords opened it.', 422);
  throw new RtaError('No mailback password is configured on the server.', 500);
}

interface ReportSummary {
  snapshotDate: string | null;
  rowsTotal: number;
  foliosUpserted: number;
  holdingsUpserted: number;
  sipsUpserted: number;
  txnsUpserted: number;
  matched: number;
  unmatched: number;
  brokerageUpserted?: number;
  schemesUpserted?: number;
  /** The file's own amount totals (brokerage ex-GST, GST) — logged for reconciliation. */
  amountTotal?: number | null;
  gstTotal?: number | null;
}

/** PAN -> client id for the PANs in this batch. */
async function clientsByPan(sb: SupabaseClient, pans: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(pans.filter(Boolean))];
  if (!list.length) return out;
  const { data } = await sb.from('nw_clients').select('id, pan').in('pan', list);
  for (const c of (data ?? []) as { id: string; pan: string | null }[]) {
    if (c.pan) out.set(c.pan.toUpperCase(), c.id);
  }
  return out;
}

// Shared holdings upsert for CAMS WBR9 and KFintech WBCUM: upsert the folio
// master + per-scheme holdings, then match folios to clients by PAN.
async function importHoldings(
  sb: SupabaseClient,
  parsed: { folios: Map<string, RtaFolioStage>; holdings: RtaHoldingStage[]; snapshotDate: string | null },
): Promise<ReportSummary> {
  const nowIso = new Date().toISOString();

  // Folios: one master row per folio. client_id / matched_at / first_seen_at
  // are left out so a re-import never clobbers an existing match.
  const folioList = [...parsed.folios.values()].map((f) => ({
    registrar: f.registrar,
    folio: f.folio,
    amc_code: f.amc_code,
    holder_name: f.holder_name,
    pan: f.pan,
    joint_names: f.joint_names,
    joint_pans: f.joint_pans,
    tax_status: f.tax_status,
    arn: f.arn,
    sub_broker: f.sub_broker,
    email: f.email,
    mobile: f.mobile,
    demat: f.demat,
    folio_open_date: f.folio_open_date,
    last_seen_at: nowIso,
  }));

  const folioIdByFolio = new Map<string, string>();
  const clientByFolio = new Map<string, string | null>();
  if (folioList.length) {
    const { data: folioRows, error } = await sb
      .from('mf_rta_folios')
      .upsert(folioList, { onConflict: 'registrar,folio' })
      .select('id, folio, client_id');
    if (error) throw new RtaError(`Could not save folios: ${error.message}`, 500);
    for (const row of (folioRows ?? []) as { id: string; folio: string; client_id: string | null }[]) {
      folioIdByFolio.set(row.folio, row.id);
      clientByFolio.set(row.folio, row.client_id);
    }
  }

  const holdingList = parsed.holdings
    .filter((h) => folioIdByFolio.has(h.folio))
    .map((h) => ({
      folio_id: folioIdByFolio.get(h.folio)!,
      registrar: h.registrar,
      folio: h.folio,
      scheme_code: h.scheme_code,
      scheme_name: h.scheme_name,
      amc_code: h.amc_code,
      units: h.units,
      rta_value: h.rta_value,
      nav: h.nav ?? null,
      nav_value: h.nav != null ? h.units * h.nav : null,
      snapshot_date: h.snapshot_date,
      updated_at: nowIso,
    }));
  if (holdingList.length) {
    const { error } = await sb
      .from('mf_rta_holdings')
      .upsert(holdingList, { onConflict: 'registrar,folio,scheme_code' });
    if (error) throw new RtaError(`Could not save holdings: ${error.message}`, 500);
  }

  // Match folios to clients by first-holder PAN. Runs for every folio so a
  // client onboarded after an earlier import gets linked on the next run.
  const byPan = await clientsByPan(sb, [...parsed.folios.values()].map((f) => f.pan ?? ''));
  let matched = 0;
  let unmatched = 0;
  for (const f of parsed.folios.values()) {
    const resolved = f.pan ? byPan.get(f.pan) : undefined;
    const existing = clientByFolio.get(f.folio) ?? null;
    if (resolved && resolved !== existing) {
      const { error } = await sb
        .from('mf_rta_folios')
        .update({ client_id: resolved, matched_at: nowIso })
        .eq('registrar', f.registrar)
        .eq('folio', f.folio);
      if (!error) matched++;
    }
    if (!(resolved ?? existing)) unmatched++;
  }

  return {
    snapshotDate: parsed.snapshotDate,
    rowsTotal: parsed.holdings.length,
    foliosUpserted: folioList.length,
    holdingsUpserted: holdingList.length,
    sipsUpserted: 0,
    txnsUpserted: 0,
    matched,
    unmatched,
  };
}

/**
 * WBR53 carries no scheme names: label them from the CAMS scheme master
 * (WBR39 → mf_rta_schemes) where it knows the code. Anything still unnamed
 * keeps the name a WBR9 import already stored (the DB never blanks it).
 */
async function withSchemeNames<T extends { holdings: RtaHoldingStage[] }>(sb: SupabaseClient, parsed: T): Promise<T> {
  const codes = [...new Set(parsed.holdings.filter((h) => !h.scheme_name).map((h) => h.scheme_code))];
  if (!codes.length) return parsed;
  const { data } = await sb.from('mf_rta_schemes').select('amc_code, scheme_code, scheme_name').in('scheme_code', codes);
  const byKey = new Map<string, string>();
  const byCode = new Map<string, string | null>();
  for (const r of (data ?? []) as { amc_code: string | null; scheme_code: string; scheme_name: string | null }[]) {
    if (!r.scheme_name) continue;
    byKey.set(`${r.amc_code ?? ''}|${r.scheme_code}`, r.scheme_name);
    // A code shared by two AMCs is ambiguous by itself: only use it when unique.
    byCode.set(r.scheme_code, byCode.has(r.scheme_code) ? null : r.scheme_name);
  }
  for (const h of parsed.holdings) {
    if (h.scheme_name) continue;
    h.scheme_name = byKey.get(`${h.amc_code ?? ''}|${h.scheme_code}`) ?? byCode.get(h.scheme_code) ?? null;
  }
  return parsed;
}

/** CAMS WBR9: parse the DBF, then share the holdings upsert. */
async function importWbr9(sb: SupabaseClient, table: DbfTable, registrar: string): Promise<ReportSummary> {
  return importHoldings(sb, parseWbr9(table, registrar));
}

// Shared SIP upsert for both CAMS WBR49 and KFintech WSREG: resolve each SIP's
// folio + client, then upsert keyed by (registrar, sip_ref).
async function importSips(
  sb: SupabaseClient,
  sips: RtaSipStage[],
  registrar: string,
  snapshotDate: string | null,
): Promise<ReportSummary> {
  const nowIso = new Date().toISOString();
  if (!sips.length) {
    return { snapshotDate, rowsTotal: 0, foliosUpserted: 0, holdingsUpserted: 0, sipsUpserted: 0, txnsUpserted: 0, matched: 0, unmatched: 0 };
  }

  // Resolve each SIP's folio (to link folio_id) and client. A WBR49 arriving
  // before its matching WBR9 may reference a folio we don't have yet — then
  // folio_id stays null and the PAN still carries the client match.
  const folios = [...new Set(sips.map((s) => s.folio))];
  const folioIdByFolio = new Map<string, string>();
  const clientByFolio = new Map<string, string | null>();
  {
    const { data } = await sb
      .from('mf_rta_folios')
      .select('id, folio, client_id')
      .eq('registrar', registrar)
      .in('folio', folios);
    for (const row of (data ?? []) as { id: string; folio: string; client_id: string | null }[]) {
      folioIdByFolio.set(row.folio, row.id);
      clientByFolio.set(row.folio, row.client_id);
    }
  }
  const byPan = await clientsByPan(sb, sips.map((s) => s.pan ?? ''));

  let matched = 0;
  let unmatched = 0;
  const rows = sips.map((s) => {
    const client = (s.pan ? byPan.get(s.pan) : undefined) ?? clientByFolio.get(s.folio) ?? null;
    if (client) matched++;
    else unmatched++;
    return {
      registrar: s.registrar,
      folio: s.folio,
      scheme_code: s.scheme_code,
      sip_ref: s.sip_ref,
      folio_id: folioIdByFolio.get(s.folio) ?? null,
      scheme_name: s.scheme_name,
      amc_code: s.amc_code,
      holder_name: s.holder_name,
      pan: s.pan,
      txn_type: s.txn_type,
      amount: s.amount,
      frequency: s.frequency,
      sip_day: s.sip_day,
      payment_mode: s.payment_mode,
      from_date: s.from_date,
      to_date: s.to_date,
      cease_date: s.cease_date,
      reg_date: s.reg_date,
      pause_from: s.pause_from,
      pause_to: s.pause_to,
      top_up_amount: s.top_up_amount,
      top_up_frequency: s.top_up_frequency,
      top_up_percent: s.top_up_percent,
      bank: s.bank,
      branch: s.branch,
      ac_type: s.ac_type,
      euin: s.euin,
      sub_arn: s.sub_arn,
      sub_broker: s.sub_broker,
      target_scheme_code: s.target_scheme_code,
      status: s.status,
      snapshot_date: s.snapshot_date,
      // client_id / matched_at only when resolved, so a later un-match (PAN
      // typo fixed) doesn't wipe a good link; first_seen_at omitted to preserve.
      ...(client ? { client_id: client, matched_at: nowIso } : {}),
      last_seen_at: nowIso,
      updated_at: nowIso,
    };
  });

  const { error } = await sb.from('mf_rta_sips').upsert(rows, { onConflict: 'registrar,sip_ref' });
  if (error) throw new RtaError(`Could not save SIPs: ${error.message}`, 500);

  return {
    snapshotDate,
    rowsTotal: sips.length,
    foliosUpserted: 0,
    holdingsUpserted: 0,
    sipsUpserted: rows.length,
    txnsUpserted: 0,
    matched,
    unmatched,
  };
}

// Shared transaction upsert for CAMS WBR2/WBR2A and (later) KFintech WBTRN:
// resolve each transaction's folio + client, then upsert keyed by
// (registrar, txn_ref) so a re-import of the same transaction overwrites it.
async function importTransactions(
  sb: SupabaseClient,
  txns: RtaTxnStage[],
  registrar: string,
  snapshotDate: string | null,
): Promise<ReportSummary> {
  const nowIso = new Date().toISOString();
  if (!txns.length) {
    return { snapshotDate, rowsTotal: 0, foliosUpserted: 0, holdingsUpserted: 0, sipsUpserted: 0, txnsUpserted: 0, matched: 0, unmatched: 0 };
  }

  // Resolve folio_id + an existing folio→client link from the folio master.
  const folios = [...new Set(txns.map((t) => t.folio))];
  const folioIdByFolio = new Map<string, string>();
  const clientByFolio = new Map<string, string | null>();
  {
    const { data } = await sb
      .from('mf_rta_folios')
      .select('id, folio, client_id')
      .eq('registrar', registrar)
      .in('folio', folios);
    for (const row of (data ?? []) as { id: string; folio: string; client_id: string | null }[]) {
      folioIdByFolio.set(row.folio, row.id);
      clientByFolio.set(row.folio, row.client_id);
    }
  }
  const byPan = await clientsByPan(sb, txns.map((t) => t.pan ?? ''));

  let matched = 0;
  let unmatched = 0;
  const rows = txns.map((t) => {
    const client = (t.pan ? byPan.get(t.pan) : undefined) ?? clientByFolio.get(t.folio) ?? null;
    if (client) matched++;
    else unmatched++;
    return {
      registrar: t.registrar,
      txn_ref: t.txn_ref,
      folio: t.folio,
      scheme_code: t.scheme_code,
      folio_id: folioIdByFolio.get(t.folio) ?? null,
      scheme_name: t.scheme_name,
      amc_code: t.amc_code,
      holder_name: t.holder_name,
      pan: t.pan,
      txn_kind: t.txn_kind,
      txn_type_raw: t.txn_type_raw,
      trade_date: t.trade_date,
      post_date: t.post_date,
      amount: t.amount,
      units: t.units,
      nav: t.nav,
      euin: t.euin,
      sub_broker: t.sub_broker,
      arn: t.arn,
      snapshot_date: t.snapshot_date ?? snapshotDate,
      ...(client ? { client_id: client, matched_at: nowIso } : {}),
      last_seen_at: nowIso,
      updated_at: nowIso,
    };
  });

  // A since-inception transaction feed can carry thousands of rows; upserting
  // them in one statement trips Postgres's statement_timeout. Chunk it so each
  // upsert stays small and fast (and a retry re-applies idempotently by txn_ref).
  const TXN_BATCH = 200;
  for (let i = 0; i < rows.length; i += TXN_BATCH) {
    const { error } = await sb
      .from('mf_rta_transactions')
      .upsert(rows.slice(i, i + TXN_BATCH), { onConflict: 'registrar,txn_ref' });
    if (error) throw new RtaError(`Could not save transactions: ${error.message}`, 500);
  }

  return {
    snapshotDate,
    rowsTotal: txns.length,
    foliosUpserted: 0,
    holdingsUpserted: 0,
    sipsUpserted: 0,
    txnsUpserted: rows.length,
    matched,
    unmatched,
  };
}

/** CAMS WBR2 / WBR2A: parse the DBF, then share the transaction upsert. */
async function importWbr2(sb: SupabaseClient, table: DbfTable, registrar: string): Promise<ReportSummary> {
  const parsed = parseWbr2(table, registrar);
  return importTransactions(sb, parsed.txns, registrar, parsed.snapshotDate);
}

/** CAMS WBR49: parse the DBF, then share the SIP upsert. */
async function importWbr49(
  sb: SupabaseClient,
  table: DbfTable,
  registrar: string,
  snapshotDate: string | null,
): Promise<ReportSummary> {
  return importSips(sb, parseWbr49(table, registrar, snapshotDate).sips, registrar, snapshotDate);
}

const EMPTY: Omit<ReportSummary, 'snapshotDate' | 'rowsTotal'> = {
  foliosUpserted: 0, holdingsUpserted: 0, sipsUpserted: 0, txnsUpserted: 0, matched: 0, unmatched: 0,
};

/**
 * CAMS WBR77 brokerage: upsert every line keyed by (registrar, row_key), match
 * to clients by folio (SQL, mf_rta_brokerage_match), then RECONCILE: the rows
 * now stamped with this file's hash must add up to the file's own record count
 * and brokerage total, or the import is refused as an error.
 */
async function importWbr77(
  sb: SupabaseClient, table: DbfTable, registrar: string, fileHash: string | null,
): Promise<ReportSummary> {
  if (!fileHash) throw new RtaError('Missing file hash for the brokerage import.', 500);
  const parsed = parseWbr77(table, registrar);
  const nowIso = new Date().toISOString();
  const rows = parsed.lines.map((l) => ({ ...l, source_file_hash: fileHash, last_seen_at: nowIso }));
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await sb.from('mf_rta_brokerage').upsert(rows.slice(i, i + BATCH), { onConflict: 'registrar,row_key' });
    if (error) throw new RtaError(`Could not save brokerage lines: ${error.message}`, 500);
  }

  const { error: mErr } = await sb.rpc('mf_rta_brokerage_match', { p_only_unmatched: true });
  if (mErr) throw new RtaError(`Could not match brokerage to clients: ${mErr.message}`, 500);

  // Reconcile what landed against the file's own totals.
  let stored = 0, storedAmt = 0, matched = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('mf_rta_brokerage')
      .select('brokerage, client_id').eq('source_file_hash', fileHash).range(from, from + 999);
    if (error) throw new RtaError(`Could not verify the brokerage import: ${error.message}`, 500);
    const page = (data ?? []) as { brokerage: number | string; client_id: string | null }[];
    for (const r of page) { stored++; storedAmt += Number(r.brokerage); if (r.client_id) matched++; }
    if (page.length < 1000) break;
  }
  if (stored !== parsed.totals.rows || Math.abs(storedAmt - parsed.totals.brokerage) > 0.0001) {
    throw new RtaError(
      `Brokerage reconciliation failed: file has ${parsed.totals.rows} lines / ₹${parsed.totals.brokerage.toFixed(4)}, ` +
      `stored ${stored} / ₹${storedAmt.toFixed(4)}.`, 500);
  }

  return {
    ...EMPTY,
    snapshotDate: parsed.snapshotDate,
    rowsTotal: parsed.totals.rows,
    brokerageUpserted: rows.length,
    matched,
    unmatched: stored - matched,
    amountTotal: parsed.totals.brokerage,
    gstTotal: parsed.totals.gst,
  };
}

/** CAMS WBR39 scheme master: upsert the labelling columns per AMC + scheme code. */
async function importWbr39(sb: SupabaseClient, table: DbfTable, registrar: string, snap: string | null): Promise<ReportSummary> {
  const { schemes, rows } = parseWbr39(table, registrar);
  const nowIso = new Date().toISOString();
  const BATCH = 500;
  for (let i = 0; i < schemes.length; i += BATCH) {
    const { error } = await sb.from('mf_rta_schemes')
      .upsert(schemes.slice(i, i + BATCH).map((s) => ({ ...s, last_seen_at: nowIso })), { onConflict: 'registrar,amc_code,scheme_code' });
    if (error) throw new RtaError(`Could not save the scheme master: ${error.message}`, 500);
  }
  return { ...EMPTY, snapshotDate: snap, rowsTotal: rows, schemesUpserted: schemes.length };
}

export interface RunImportOptions {
  zipBytes: Uint8Array;
  passwords: string[];
  registrar: 'CAMS' | 'KFINTECH';
  sourceFile?: string | null;
  messageId?: string | null;
  source: 'manual' | 'auto';
  importedBy: string | null;
  /** Skip (don't re-import) a ZIP whose content was already imported OK. */
  dedupe?: boolean;
}

export interface RunImportResult extends ReportSummary {
  ok: true;
  skipped?: boolean;
  reason?: string;
  registrar: string;
  report: RtaReport | null;
  sourceFile: string | null;
  messageId: string | null;
  fileHash: string | null;
  durationMs: number;
}

/**
 * Decrypt → detect → parse → upsert → match → log. Throws RtaError (carrying an
 * HTTP status) on failure, having first written an 'error' import-log row.
 */
export async function runImport(sb: SupabaseClient, opts: RunImportOptions): Promise<RunImportResult> {
  const started = Date.now();
  const { zipBytes, passwords, registrar, source, importedBy } = opts;
  const messageId = opts.messageId ?? null;
  let sourceFile = opts.sourceFile ?? null;
  let report: RtaReport | null = null;
  let fileHash: string | null = null;
  let snapshotDate: string | null = null;
  let warning: string | null = null;

  try {
    if (!zipBytes?.length) throw new RtaError('The uploaded file is empty.', 400);
    if (zipBytes.length > MAX_ZIP_BYTES) throw new RtaError('That file is too large.', 413);
    fileHash = await sha256Hex(zipBytes);

    if (opts.dedupe) {
      const { data: dup } = await sb
        .from('mf_rta_import_log')
        .select('id, report, snapshot_date')
        .eq('file_hash', fileHash)
        .eq('status', 'ok')
        .limit(1)
        .maybeSingle();
      if (dup) {
        const d = dup as { report: RtaReport | null; snapshot_date: string | null };
        return {
          ok: true, skipped: true, reason: 'duplicate',
          registrar, report: d.report, sourceFile, messageId, fileHash,
          snapshotDate: d.snapshot_date, rowsTotal: 0, foliosUpserted: 0,
          holdingsUpserted: 0, sipsUpserted: 0, txnsUpserted: 0, matched: 0, unmatched: 0,
          durationMs: Date.now() - started,
        };
      }
    }

    const { name, bytes } = await unzipFeed(zipBytes, passwords);
    if (!sourceFile) sourceFile = name;

    // The snapshot date lives in the inner member name (CAMS DBF and KFintech
    // CSV both name it ...DDMMYYYY...); the outer ZIP name is a fallback.
    const snap = snapshotFromName(name) ?? snapshotFromName(sourceFile);

    let summary: ReportSummary;
    if (/\.csv$/i.test(name)) {
      // KFintech feeds are CSV. Only the SIP registration report is mapped yet;
      // the master/transaction reports log as unrecognised until their layouts
      // are added, so the Apps Script marks them handled rather than retrying.
      const csv = parseCsv(bytes);
      if (isKfSip(csv)) {
        report = 'WSREG';
        summary = await importSips(sb, parseKfSip(csv, registrar, snap), registrar, snap);
      } else if (isKfAum(csv)) {
        report = 'WBCUM';
        summary = await importHoldings(sb, parseKfAum(csv, registrar));
      } else if (isKfMaster(csv)) {
        report = 'WBMST';
        summary = await importHoldings(sb, parseKfMaster(csv, registrar));
      } else if (isWbtrn(csv)) {
        report = 'WBTRN';
        const parsed = parseWbtrn(csv, registrar);
        summary = await importTransactions(sb, parsed.txns, registrar, parsed.snapshotDate ?? snap);
      } else {
        throw new RtaError('Unrecognised KFintech CSV feed (expected a SIP registration, Client-wise AUM, Investor Master, or Transaction Feeds report).', 422,
          csvLayout(name, csv.header, csv.rows.length));
      }
    } else {
      const table = parseDbf(bytes);
      report = detectReport(table);
      if (!report) {
        throw new RtaError('Unrecognised registrar feed (not a WBR9/WBR22/WBR53 holdings, WBR49 SIP, WBR2 transaction, WBR77 brokerage or WBR39 scheme-master file).', 422,
          dbfLayout(name, table));
      }
      if (table.truncated) {
        // The DBF ended before its declared record count — the feed is short
        // (seen with oversized CAMS files). We still import the rows we got, but
        // flag it so the import is not trusted as complete and can be re-pulled.
        warning = `TRUNCATED: feed declared ${table.declaredCount} records but ended early at ${table.rows.length}; imported partial data — re-pull for the full feed.`;
      }
      // WBR77 must be complete to reconcile: a truncated brokerage file is refused.
      if (report === 'WBR77' && table.truncated) {
        throw new RtaError(`WBR77 file is truncated (declared ${table.declaredCount} records, read ${table.rows.length}); re-pull it.`, 422);
      }
      switch (report) {
        case 'WBR77': summary = await importWbr77(sb, table, registrar, fileHash); break;
        case 'WBR39': summary = await importWbr39(sb, table, registrar, snap); break;
        case 'WBR9': summary = await importWbr9(sb, table, registrar); break;
        case 'WBR53': summary = await importHoldings(sb, await withSchemeNames(sb, parseWbr53(table, registrar))); break;
        case 'WBR22': summary = await importHoldings(sb, parseWbr22(table, registrar)); break;
        case 'WBR2': summary = await importWbr2(sb, table, registrar); break;
        default: summary = await importWbr49(sb, table, registrar, snap);
      }
    }
    snapshotDate = summary.snapshotDate;

    await sb.from('mf_rta_import_log').insert({
      registrar, report, source_file: sourceFile, file_hash: fileHash, message_id: messageId, source,
      snapshot_date: snapshotDate, rows_total: summary.rowsTotal,
      folios_upserted: summary.foliosUpserted, holdings_upserted: summary.holdingsUpserted,
      sips_upserted: summary.sipsUpserted, txns_upserted: summary.txnsUpserted,
      matched: summary.matched, unmatched: summary.unmatched,
      brokerage_upserted: summary.brokerageUpserted ?? 0, schemes_upserted: summary.schemesUpserted ?? 0,
      amount_total: summary.amountTotal ?? null, gst_total: summary.gstTotal ?? null,
      status: 'ok', error: warning, duration_ms: Date.now() - started, imported_by: importedBy,
    });

    return {
      ok: true, registrar, report, sourceFile, messageId, fileHash,
      ...summary, durationMs: Date.now() - started,
    };
  } catch (e) {
    const status = e instanceof RtaError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Import failed.';
    try {
      await sb.from('mf_rta_import_log').insert({
        registrar, report, source_file: sourceFile, file_hash: fileHash, message_id: messageId, source,
        status: 'error', error: message.slice(0, 500), duration_ms: Date.now() - started, imported_by: importedBy,
        layout: e instanceof RtaError ? (e.layout ?? null) : null,
      });
    } catch { /* best-effort */ }
    throw new RtaError(message, status);
  }
}
