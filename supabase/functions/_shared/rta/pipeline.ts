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
import { isKfAum, isKfSip, parseKfAum, parseKfSip } from './kfintech.ts';
import { isWbtrn, parseWbtrn } from './wbtrn.ts';
import type { RtaTxnStage } from './txns.ts';
import { unzipMember, WinzipError } from './winzip.ts';

/** A base64 body inflates by a third; the ZIPs are a few KB, cap well above. */
export const MAX_ZIP_BYTES = 8 * 1024 * 1024;

export class RtaError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
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

export type RtaReport = 'WBR9' | 'WBR49' | 'WSREG' | 'WBCUM' | 'WBR2' | 'WBTRN';

/** Which report is this? Matched by column presence, not file name. */
export function detectReport(table: DbfTable): RtaReport | null {
  const names = new Set(table.fields.map((f) => f.name));
  if (['FOLIOCHK', 'CLOS_BAL', 'SCH_NAME'].every((n) => names.has(n))) return 'WBR9';
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
      } else if (isWbtrn(csv)) {
        report = 'WBTRN';
        const parsed = parseWbtrn(csv, registrar);
        summary = await importTransactions(sb, parsed.txns, registrar, parsed.snapshotDate ?? snap);
      } else {
        throw new RtaError('Unrecognised KFintech CSV feed (expected a SIP registration, Client-wise AUM, or Transaction Feeds report).', 422);
      }
    } else {
      const table = parseDbf(bytes);
      report = detectReport(table);
      if (!report) {
        throw new RtaError('Unrecognised registrar feed (not a WBR9 holdings, WBR49 SIP, or WBR2 transaction file).', 422);
      }
      if (table.truncated) {
        // The DBF ended before its declared record count — the feed is short
        // (seen with oversized CAMS files). We still import the rows we got, but
        // flag it so the import is not trusted as complete and can be re-pulled.
        warning = `TRUNCATED: feed declared ${table.declaredCount} records but ended early at ${table.rows.length}; imported partial data — re-pull for the full feed.`;
      }
      summary = report === 'WBR9'
        ? await importWbr9(sb, table, registrar)
        : report === 'WBR2'
          ? await importWbr2(sb, table, registrar)
          : await importWbr49(sb, table, registrar, snap);
    }
    snapshotDate = summary.snapshotDate;

    await sb.from('mf_rta_import_log').insert({
      registrar, report, source_file: sourceFile, file_hash: fileHash, message_id: messageId, source,
      snapshot_date: snapshotDate, rows_total: summary.rowsTotal,
      folios_upserted: summary.foliosUpserted, holdings_upserted: summary.holdingsUpserted,
      sips_upserted: summary.sipsUpserted, txns_upserted: summary.txnsUpserted,
      matched: summary.matched, unmatched: summary.unmatched,
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
      });
    } catch { /* best-effort */ }
    throw new RtaError(message, status);
  }
}
