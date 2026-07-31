/**
 * POST /cas/import — turn an uploaded Consolidated Account Statement into rows.
 *
 * This lives on the proxy rather than in an edge function because the parser
 * does, and the parser lives here because this is the only Node host we own
 * that holds the service-role key. A CAS is a client's entire financial life;
 * it is read, parsed and discarded in this process and never stored as a file.
 *
 * ## The gate
 *
 * RTAs change CAS layouts, and a drifting text parser does not crash — it
 * silently matches fewer rows. "Your savings are 1.4L" when they are 2.2L is
 * far worse than an error, so nothing here is written as authoritative until
 * the parse has been checked against figures the document states for itself:
 *
 *   summary  — the fused "Total <market><cost>" line.
 *   detailed — every scheme's own closing balance and, when the statement
 *              prints one, the portfolio total as well.
 *
 * A parse that fails those checks is still stored, with status 'mismatch' and
 * the reason in `error`, because a layout change we cannot see is not
 * debuggable. The app reads only status='reconciled'.
 *
 * ## Whose statement is this
 *
 * The import is always attached to a client resolved from the CALLER (their own
 * record, or the one a staff member named) — never from the document. The PAN
 * printed in the statement is then required to match that client's, so a
 * statement belonging to someone else cannot be filed against a client's
 * portfolio, whether by mistake or on purpose.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { ProxyConfig } from '../config.js';
import { CasPasswordError, extractCasText } from './extract.js';
import {
  normalizeLines,
  parseCas,
  readInvestor,
  readInvestorPans,
  readStatedTotals,
  readStatementPeriod,
  type CasHolding,
  type CasParseResult,
} from './parse.js';
import { parseDetailedSchemes, type CasDetailedScheme } from './detailed.js';

/** A base64 PDF inflates by a third; express.json is capped at 10mb. */
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** Money to the paisa; units to the thousandth — the precision a CAS prints. */
const nearMoney = (a: number, b: number) => Math.abs(a - b) <= 0.01;
const nearUnits = (a: number, b: number) => Math.abs(a - b) <= 0.001;

const money = (n: number) => n.toFixed(2);

/** Never write another person's PAN against a client's record. */
const maskPan = (pan: string) => `${pan.slice(0, 2)}XXXXXX${pan.slice(-2)}`;

class CasError extends Error {
  constructor(
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'CasError';
  }
}

/* ----------------------------------------------------------- Supabase I/O -- */

function serviceHeaders(cfg: ProxyConfig): Record<string, string> {
  const key = cfg.supabaseServiceRoleKey;
  if (!key) throw new CasError('Portfolio import is not configured on this server.', 503);
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

async function sbSelect<T>(cfg: ProxyConfig, path: string): Promise<T[]> {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, { headers: serviceHeaders(cfg) });
  if (!r.ok) {
    throw new CasError(`Could not read from the database (${r.status}).`, 502);
  }
  return (await r.json()) as T[];
}

/**
 * Rows carry client-generated ids so children can be built before anything is
 * sent — one round trip per table instead of one per row, and no dependence on
 * PostgREST returning inserted rows in the order they were given.
 */
async function sbInsert(cfg: ProxyConfig, table: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...serviceHeaders(cfg), Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new CasError(`Could not save the statement (${table}: ${body.slice(0, 200)}).`, 502);
  }
}

async function sbDelete(cfg: ProxyConfig, path: string): Promise<void> {
  await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: serviceHeaders(cfg),
  }).catch(() => undefined);
}

/* --------------------------------------------------------- reconciliation -- */

interface Reconciliation {
  reconciled: boolean;
  statedMarket: number | null;
  statedCost: number | null;
  parsedMarket: number;
  parsedCost: number;
  /** Why it did not reconcile — stored on the import row for diagnosis. */
  failures: string[];
  warnings: string[];
}

/**
 * Check a detailed parse against the statement's own arithmetic.
 *
 * Two independent checks per scheme, because they fail differently:
 *
 *   opening + sum(units) == closing   catches a DROPPED transaction, and also a
 *                                     price/units split the parser could not
 *                                     resolve (it leaves units at zero).
 *   last running balance == closing   catches a transaction attributed to the
 *                                     wrong scheme.
 *
 * A scheme dropped in its entirety escapes both — a block that was never parsed
 * has nothing to disagree with — which is what the portfolio total is for. Not
 * every detailed statement prints one, so its absence downgrades to a warning
 * rather than silently passing as agreement.
 */
export function reconcileDetailed(schemes: CasDetailedScheme[], lines: string[]): Reconciliation {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const s of schemes) {
    const where = `${s.schemeName} (folio ${s.folioNumber || 'unknown'})`;
    const ledger = s.transactions.reduce((sum, t) => sum + t.units, s.openingUnits);
    if (!nearUnits(ledger, s.closingUnits)) {
      failures.push(
        `${where}: the transactions add up to ${ledger.toFixed(3)} units but the statement closes at ${s.closingUnits.toFixed(3)}.`,
      );
    }
    if (s.balanceMismatch !== null) {
      failures.push(
        `${where}: the running balance ends ${s.balanceMismatch.toFixed(3)} units away from the stated closing balance.`,
      );
    }
    // txn_date is NOT NULL, so an unreadable date would be dropped on the way
    // to the database — a hole the unit checks above cannot see.
    const undated = s.transactions.filter((t) => !t.date).length;
    if (undated) {
      failures.push(`${where}: ${undated} transaction(s) carry a date this parser could not read.`);
    }
    // Units x NAV should reproduce the stated market value. NAV is printed
    // rounded, so this cannot be exact on a large holding — a warning, never a
    // gate, or rounding alone would block real statements.
    const implied = s.closingUnits * s.nav;
    if (s.marketValue > 0 && Math.abs(implied - s.marketValue) > Math.max(1, s.marketValue * 0.001)) {
      warnings.push(
        `${where}: ${s.closingUnits.toFixed(3)} units at NAV ${s.nav} comes to ${money(implied)}, but the statement says ${money(s.marketValue)}.`,
      );
    }
  }

  const parsedMarket = schemes.reduce((sum, s) => sum + s.marketValue, 0);
  const parsedCost = schemes.reduce((sum, s) => sum + s.costValue, 0);

  const stated = readStatedTotals(lines);
  if (stated) {
    if (!nearMoney(parsedMarket, stated.marketValue) || !nearMoney(parsedCost, stated.costValue)) {
      failures.push(
        `The schemes total ${money(parsedMarket)} against the statement's ${money(stated.marketValue)}, ` +
          `and cost ${money(parsedCost)} against ${money(stated.costValue)} — a scheme was probably missed entirely.`,
      );
    }
  } else {
    warnings.push(
      'This statement prints no portfolio total, so each scheme was checked against its own closing balance but the set of schemes could not be checked for completeness.',
    );
  }

  if (!schemes.length) failures.push('No schemes were found in this statement.');

  return {
    reconciled: failures.length === 0,
    statedMarket: stated ? stated.marketValue : null,
    statedCost: stated ? stated.costValue : null,
    parsedMarket,
    parsedCost,
    failures,
    warnings,
  };
}

/**
 * The summary variant already reconciles itself against the document's total —
 * this only restates the outcome in the shape the route stores, keeping the
 * parser's advisory notes (chiefly "this is a Summary statement") out of the
 * failure list, where they would read as a layout problem.
 */
export function reconcileSummary(parsed: CasParseResult): Reconciliation {
  const failures: string[] = [];
  if (!parsed.reconciled) {
    failures.push(
      parsed.statedMarketValue === null
        ? 'This statement prints no total, so the parse could not be checked against it.'
        : `The holdings total ${money(parsed.parsedMarketValue)} against the statement's ${money(parsed.statedMarketValue)}, ` +
          `and cost ${money(parsed.parsedCostValue)} against ${money(parsed.statedCostValue ?? 0)} — a holding was probably missed.`,
    );
  }
  if (!parsed.holdings.length) failures.push('No holdings were found in this statement.');
  return {
    reconciled: failures.length === 0,
    statedMarket: parsed.statedMarketValue,
    statedCost: parsed.statedCostValue,
    parsedMarket: parsed.parsedMarketValue,
    parsedCost: parsed.parsedCostValue,
    failures,
    warnings: parsed.warnings,
  };
}

/* ------------------------------------------------------------- row shapes -- */

/** What both statement variants reduce to before being written. */
interface ImportRows {
  folios: Record<string, unknown>[];
  schemes: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
}

interface FolioKey {
  id: string;
  folioNumber: string;
  amc: string | null;
  registrar: string | null;
  value: number;
}

/** One row per folio, with its schemes' market values rolled up. */
function foldFolios(
  entries: { folioNumber: string; amc?: string; registrar?: string; marketValue: number }[],
): Map<string, FolioKey> {
  const folios = new Map<string, FolioKey>();
  for (const e of entries) {
    const key = e.folioNumber || 'unknown';
    const cur =
      folios.get(key) ??
      { id: randomUUID(), folioNumber: key, amc: null, registrar: null, value: 0 };
    cur.value += e.marketValue;
    if (!cur.amc && e.amc) cur.amc = e.amc;
    if (!cur.registrar && e.registrar) cur.registrar = e.registrar.toUpperCase();
    folios.set(key, cur);
  }
  return folios;
}

const gain = (value: number, cost: number) => ({
  gain_absolute: Number((value - cost).toFixed(2)),
  gain_percent: cost > 0 ? Number((((value - cost) / cost) * 100).toFixed(4)) : null,
});

function rowsFromHoldings(
  holdings: CasHolding[],
  importId: string,
  clientId: string,
): ImportRows {
  const folios = foldFolios(holdings);
  return {
    folios: [...folios.values()].map((f) => ({
      id: f.id,
      import_id: importId,
      client_id: clientId,
      folio_number: f.folioNumber,
      amc: f.amc,
      registrar: f.registrar,
      value: Number(f.value.toFixed(2)),
    })),
    schemes: holdings.map((h) => ({
      id: randomUUID(),
      import_id: importId,
      folio_id: folios.get(h.folioNumber || 'unknown')!.id,
      client_id: clientId,
      isin: h.isin,
      rta: h.registrar,
      rta_code: h.rtaCode || null,
      name: h.schemeName,
      units: h.units,
      nav: h.nav,
      nav_date: h.navDate || null,
      value: h.marketValue,
      cost: h.costValue,
      ...gain(h.marketValue, h.costValue),
      // A summary statement carries no advisor code at all, so every holding
      // would read as held away. Left null, which is honestly "not stated".
      advisor_code: null,
    })),
    transactions: [],
  };
}

function rowsFromSchemes(
  schemes: CasDetailedScheme[],
  importId: string,
  clientId: string,
): ImportRows {
  const folios = foldFolios(schemes);
  const schemeRows: Record<string, unknown>[] = [];
  const txnRows: Record<string, unknown>[] = [];

  for (const s of schemes) {
    const schemeId = randomUUID();
    schemeRows.push({
      id: schemeId,
      import_id: importId,
      folio_id: folios.get(s.folioNumber || 'unknown')!.id,
      client_id: clientId,
      isin: s.isin,
      rta: s.registrar || null,
      rta_code: s.rtaCode || null,
      name: s.schemeName,
      units: s.closingUnits,
      nav: s.nav,
      nav_date: s.navDate || null,
      value: s.marketValue,
      cost: s.costValue,
      ...gain(s.marketValue, s.costValue),
      advisor_code: s.advisorCode || null,
    });
    for (const t of s.transactions) {
      if (!t.date) continue; // txn_date is NOT NULL, and an undated row is unusable
      txnRows.push({
        import_id: importId,
        scheme_id: schemeId,
        client_id: clientId,
        txn_date: t.date,
        description: t.description,
        txn_type: t.type,
        amount: t.amount,
        units: t.units,
        nav: t.nav,
        balance_units: t.balanceUnits,
        stamp_duty: t.type === 'STAMP_DUTY' ? Math.abs(t.amount) : null,
      });
    }
  }

  return {
    folios: [...folios.values()].map((f) => ({
      id: f.id,
      import_id: importId,
      client_id: clientId,
      folio_number: f.folioNumber,
      amc: f.amc,
      registrar: f.registrar,
      value: Number(f.value.toFixed(2)),
    })),
    schemes: schemeRows,
    transactions: txnRows,
  };
}

/* ----------------------------------------------------------------- route -- */

interface ClientRow {
  id: string;
  pan: string | null;
  full_name: string | null;
  email: string | null;
}

export function casRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as {
        fileBase64?: string;
        fileName?: string;
        password?: string;
        clientId?: string;
      };

      const password = String(body.password ?? '');
      if (!password) {
        // Not the PAN — the investor chooses this on the CAMS request form, and
        // assuming otherwise is the single most common way this fails.
        throw new CasError('The statement password is required — it is the one you chose when you requested the CAS.');
      }
      if (!body.fileBase64) throw new CasError('No statement was uploaded.');

      const pdf = Buffer.from(body.fileBase64, 'base64');
      if (pdf.length > MAX_PDF_BYTES) {
        throw new CasError(`That file is larger than the ${MAX_PDF_BYTES / 1024 / 1024} MB limit.`, 413);
      }
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new CasError('That file is not a PDF. Upload the CAS exactly as the RTA emailed it.');
      }
      const sha256 = createHash('sha256').update(pdf).digest('hex');

      /* -------------------------------------------------- whose statement */
      const caller = req.caller;
      if (!caller) throw new CasError('Caller not resolved.', 401);

      const clientId =
        caller.kind === 'staff' ? String(body.clientId ?? '').trim() : (caller.clientId ?? '');
      if (!clientId) {
        throw new CasError(
          caller.kind === 'staff'
            ? 'A client is required — say whose statement this is.'
            : 'Your client record could not be found.',
          caller.kind === 'staff' ? 400 : 403,
        );
      }
      if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new CasError('That is not a valid client id.', 400);
      const [client] = await sbSelect<ClientRow>(
        cfg,
        `nw_clients?select=id,pan,full_name,email&id=eq.${encodeURIComponent(clientId)}&limit=1`,
      );
      if (!client) throw new CasError('That client does not exist.', 404);

      /* -------------------------------------------------------- duplicate */
      const [existing] = await sbSelect<{ id: string; status: string }>(
        cfg,
        `cas_imports?select=id,status&client_id=eq.${encodeURIComponent(clientId)}` +
          `&file_sha256=eq.${sha256}&limit=1`,
      );
      if (existing?.status === 'reconciled') {
        return res.json({
          importId: existing.id,
          clientId,
          duplicate: true,
          status: 'reconciled',
          message: 'This statement has already been imported.',
        });
      }
      // A previous attempt that did not reconcile is replaced, so re-uploading
      // after a parser fix succeeds instead of colliding with the unique index.
      if (existing) await sbDelete(cfg, `cas_imports?id=eq.${existing.id}`);

      /* ------------------------------------------------------------ parse */
      let text: string;
      try {
        text = await extractCasText(pdf, password);
      } catch (err) {
        if (err instanceof CasPasswordError) {
          throw new CasError(
            'That password did not open the statement. It is the password you chose on the CAMS request form, not your PAN.',
            422,
          );
        }
        throw new CasError('That file could not be read as a CAS PDF.', 422);
      }

      const warnings: string[] = [];

      // The PAN comes from the document but decides nothing about ownership —
      // it only has to agree with the client this import is already attached to.
      const clientPan = (client.pan ?? '').trim().toUpperCase();
      const statementPans = readInvestorPans(text);
      if (clientPan && statementPans.length && !statementPans.includes(clientPan)) {
        console.warn(
          `[cas] refused: statement PAN ${statementPans.map(maskPan).join(', ')} does not match client ${clientId}`,
        );
        await sbInsert(cfg, 'cas_imports', [
          {
            client_id: clientId,
            file_name: body.fileName ?? null,
            file_sha256: sha256,
            source: caller.kind === 'staff' ? 'staff_upload' : 'client_upload',
            status: 'failed',
            error: `Statement is for PAN ${statementPans.map(maskPan).join(', ')}, not this client.`,
            created_by: caller.kind === 'staff' ? (caller.employeeId ?? null) : null,
          },
        ]);
        throw new CasError(
          'This statement belongs to a different PAN, so it has not been imported.',
          409,
        );
      }
      if (!statementPans.length) {
        warnings.push('The statement does not print a full PAN, so it could not be matched against the client record.');
      }

      const isDetailed = !/Consolidated Account Summary/i.test(text);
      const lines = normalizeLines(text);
      const period = readStatementPeriod(text);

      const investor = readInvestor(text);

      let recon: Reconciliation;
      let build: (importId: string) => ImportRows;

      if (isDetailed) {
        const schemes = parseDetailedSchemes(text);
        recon = reconcileDetailed(schemes, lines);
        build = (id) => rowsFromSchemes(schemes, id, clientId);
      } else {
        const parsed = parseCas(text);
        recon = reconcileSummary(parsed);
        build = (id) => rowsFromHoldings(parsed.holdings, id, clientId);
      }
      warnings.push(...recon.warnings);

      /* ------------------------------------------------------------ write */
      const importId = randomUUID();
      const rows = build(importId);
      const status = recon.reconciled ? 'reconciled' : 'mismatch';

      await sbInsert(cfg, 'cas_imports', [
        {
          id: importId,
          client_id: clientId,
          investor_pan: statementPans[0] ?? null,
          investor_name: investor.name || client.full_name,
          investor_email: investor.email || client.email,
          source: caller.kind === 'staff' ? 'staff_upload' : 'client_upload',
          cas_type: 'CAMS_KFINTECH',
          statement_from: period?.from ?? null,
          statement_to: period?.to ?? null,
          file_name: body.fileName ?? null,
          file_sha256: sha256,
          status,
          stated_total: recon.statedMarket,
          parsed_total: Number(recon.parsedMarket.toFixed(2)),
          variance:
            recon.statedMarket === null
              ? null
              : Number((recon.parsedMarket - recon.statedMarket).toFixed(2)),
          folio_count: rows.folios.length,
          scheme_count: rows.schemes.length,
          transaction_count: rows.transactions.length,
          error: recon.failures.length ? recon.failures.join(' ') : null,
          created_by: caller.kind === 'staff' ? (caller.employeeId ?? null) : null,
        },
      ]);

      try {
        await sbInsert(cfg, 'cas_folios', rows.folios);
        await sbInsert(cfg, 'cas_schemes', rows.schemes);
        // 365 transactions on a since-inception statement is normal; chunked so
        // a long history cannot exceed PostgREST's request limits.
        for (let i = 0; i < rows.transactions.length; i += 500) {
          await sbInsert(cfg, 'cas_transactions', rows.transactions.slice(i, i + 500));
        }
      } catch (err) {
        // Half an imported portfolio is worse than none — the children cascade,
        // so dropping the import row removes whatever landed.
        await sbDelete(cfg, `cas_imports?id=eq.${importId}`);
        throw err;
      }

      res.json({
        importId,
        clientId,
        duplicate: false,
        status,
        variant: isDetailed ? 'detailed' : 'summary',
        statementFrom: period?.from ?? null,
        statementTo: period?.to ?? null,
        counts: {
          folios: rows.folios.length,
          schemes: rows.schemes.length,
          transactions: rows.transactions.length,
        },
        totals: {
          statedMarketValue: recon.statedMarket,
          parsedMarketValue: Number(recon.parsedMarket.toFixed(2)),
          statedCostValue: recon.statedCost,
          parsedCostValue: Number(recon.parsedCost.toFixed(2)),
        },
        // Stored either way; the app must ignore anything not 'reconciled'.
        failures: recon.failures,
        warnings,
      });
    } catch (err) {
      next(err);
    }
  });

  /** Local, because the app-level handler flattens anything unrecognised to 500. */
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CasError) {
      return res.status(err.httpStatus).json({ error: err.message });
    }
    console.error('[cas] unexpected', err);
    return res.status(500).json({ error: 'The statement could not be imported.' });
  });

  return router;
}
