// Import a Consolidated Account Statement.
//
// Moved off the BSE droplet, which exists for a whitelisted static IP that BSE
// StAR MF and the Cashfree relay need. Parsing a PDF the client uploads needs
// no static IP and was only there because that was the server that existed.
//
// The logic is unchanged from the droplet's express route — the parser, the
// reconciliation and the row builders are the same modules under _shared/cas,
// with the same ~120 tests. Three things genuinely differ:
//
//   pdfjs-dist -> unpdf   pdfjs cannot boot in this runtime at all; the two are
//                         proven to extract identical text (see
//                         extractorEquivalence.test.ts)
//   req.caller  -> JWT    the droplet had middleware resolving staff vs client;
//                         here it comes from the caller's own token
//   Buffer      -> Uint8Array
//
// ## Authorisation
//
// verify_jwt is ON. A client may only ever import against their own record: the
// client id is taken from THEIR token, never from the request body, so a
// forged clientId cannot attach someone else's statement to another portfolio.
// Staff may name a client, and only staff.
//
// A statement is also refused outright if its PAN is not the client's. That
// check is not about authorisation — it catches a family member's statement
// being uploaded by mistake, which is the one failure a client cannot resolve
// alone.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { CasPasswordError, extractCasText } from '../_shared/cas/extract.ts';
import {
  normalizeLines,
  parseCas,
  readInvestor,
  readInvestorPans,
  readStatementPeriod,
} from '../_shared/cas/parse.ts';
import { parseDetailedSchemes } from '../_shared/cas/detailed.ts';
import {
  reconcileDetailed,
  reconcileSummary,
  rowsFromHoldings,
  rowsFromSchemes,
  type ImportRows,
  type Reconciliation,
} from '../_shared/cas/reconcile.ts';
import { CasError, envConfig, sbDelete, sbInsert, sbPatch, sbSelect } from '../_shared/cas/db.ts';
import { alertRm } from '../_shared/cas/alerts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** A base64 PDF inflates by a third; the request body is capped well above it. */
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** Never write another person's PAN against a client's record. */
const maskPan = (pan: string) => `${pan.slice(0, 2)}XXXXXX${pan.slice(-2)}`;

const UUID = /^[0-9a-f-]{36}$/i;

interface ClientRow {
  id: string;
  pan: string | null;
  full_name: string | null;
  email: string | null;
}

type Caller =
  | { kind: 'client'; clientId: string }
  | { kind: 'staff'; employeeId: string | null };

/**
 * Who is calling, from their own token.
 *
 * Resolved against the database rather than trusted from the JWT's claims: a
 * token proves who the user is, not what they may do. An employee row must be
 * active, and a client is found by the auth user id stored on their record.
 */
async function resolveCaller(req: Request): Promise<Caller> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) throw new CasError('Caller not resolved.', 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData, error } = await supabase.auth.getUser(token);
  const uid = userData?.user?.id;
  if (error || !uid) throw new CasError('Your session has expired. Sign in again.', 401);

  const { data: employee } = await supabase
    .from('nw_employees')
    .select('id')
    .eq('auth_user_id', uid)
    .eq('status', 'active')
    .maybeSingle();
  if (employee) return { kind: 'staff', employeeId: (employee as { id: string }).id };

  const { data: client } = await supabase
    .from('nw_clients')
    .select('id')
    .eq('client_auth_user_id', uid)
    .maybeSingle();
  if (client) return { kind: 'client', clientId: (client as { id: string }).id };

  throw new CasError('Your client record could not be found.', 403);
}

/** base64 -> bytes, without pulling in Buffer. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const asciiHead = (bytes: Uint8Array, n: number) =>
  String.fromCharCode(...Array.from(bytes.subarray(0, n)));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const cfg = envConfig();

  try {
    const body = (await req.json()) as {
      fileBase64?: string;
      fileName?: string;
      password?: string;
      clientId?: string;
      /** Links this import back to the tracked request that produced it. */
      requestId?: string;
    };

    const requestId = UUID.test(String(body.requestId ?? '')) ? String(body.requestId) : null;

    const password = String(body.password ?? '');
    if (!password) {
      // Not the PAN — the investor chooses this on the CAMS request form, and
      // assuming otherwise is the single most common way this fails.
      throw new CasError(
        'The statement password is required — it is the one you chose when you requested the CAS.',
      );
    }
    if (!body.fileBase64) throw new CasError('No statement was uploaded.');

    const pdf = decodeBase64(body.fileBase64);
    if (pdf.length > MAX_PDF_BYTES) {
      throw new CasError(`That file is larger than the ${MAX_PDF_BYTES / 1024 / 1024} MB limit.`, 413);
    }
    if (asciiHead(pdf, 5) !== '%PDF-') {
      throw new CasError('That file is not a PDF. Upload the CAS exactly as the RTA emailed it.');
    }
    const sha256 = await sha256Hex(pdf);

    /* ---------------------------------------------------- whose statement */
    const caller = await resolveCaller(req);

    const clientId =
      caller.kind === 'staff' ? String(body.clientId ?? '').trim() : caller.clientId;
    if (!clientId) {
      throw new CasError('A client is required — say whose statement this is.', 400);
    }
    if (!UUID.test(clientId)) throw new CasError('That is not a valid client id.', 400);

    const [client] = await sbSelect<ClientRow>(
      cfg,
      `nw_clients?select=id,pan,full_name,email&id=eq.${encodeURIComponent(clientId)}&limit=1`,
    );
    if (!client) throw new CasError('That client does not exist.', 404);

    /* ------------------------------------------------------------ duplicate */
    const [existing] = await sbSelect<{ id: string; status: string }>(
      cfg,
      `cas_imports?select=id,status&client_id=eq.${encodeURIComponent(clientId)}` +
        `&file_sha256=eq.${sha256}&limit=1`,
    );
    if (existing?.status === 'reconciled') {
      return json({
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

    /* ---------------------------------------------------------------- parse */
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

    // The PAN comes from the document but decides nothing about ownership — it
    // only has to agree with the client this import is already attached to.
    const clientPan = (client.pan ?? '').trim().toUpperCase();
    const statementPans = readInvestorPans(text);
    if (clientPan && statementPans.length && !statementPans.includes(clientPan)) {
      const masked = statementPans.map(maskPan).join(', ');
      console.warn(`[cas] refused: statement PAN ${masked} does not match client ${clientId}`);
      await sbInsert(cfg, 'cas_imports', [
        {
          client_id: clientId,
          file_name: body.fileName ?? null,
          file_sha256: sha256,
          source: caller.kind === 'staff' ? 'staff_upload' : 'client_upload',
          status: 'failed',
          error: `Statement is for PAN ${masked}, not this client.`,
          created_by: caller.kind === 'staff' ? caller.employeeId : null,
          request_id: requestId,
        },
      ]);
      if (requestId) {
        await sbPatch(cfg, `cas_requests?id=eq.${requestId}`, {
          status: 'failed',
          failure_reason: 'The statement was for a different PAN.',
          completed_at: new Date().toISOString(),
        });
      }
      // A PAN mismatch is the one failure a client cannot resolve alone — it
      // usually means a family member's statement, and someone has to say so.
      await alertRm(cfg, 'panMismatch', {
        clientId,
        clientLabel: client.full_name ?? clientId,
        detail: `Uploaded a statement for PAN ${masked}, which is not theirs. Nothing was imported.`,
      });
      throw new CasError(
        'This statement belongs to a different PAN, so it has not been imported.',
        409,
      );
    }
    if (!statementPans.length) {
      warnings.push(
        'The statement does not print a full PAN, so it could not be matched against the client record.',
      );
    }

    const isDetailed = !/Consolidated Account Summary/i.test(text);
    const lines = normalizeLines(text);
    const period = readStatementPeriod(text);
    const investor = readInvestor(text);

    let recon: Reconciliation;
    let build: (importId: string) => ImportRows;
    // A summary statement states a single "As on" date rather than a period.
    let statementTo = period?.to ?? null;

    if (isDetailed) {
      const schemes = parseDetailedSchemes(text);
      recon = reconcileDetailed(schemes, lines);
      build = (id) => rowsFromSchemes(schemes, id, clientId);
    } else {
      const parsed = parseCas(text);
      recon = reconcileSummary(parsed);
      statementTo = parsed.statementDate ?? statementTo;
      build = (id) => rowsFromHoldings(parsed.holdings, id, clientId);
    }
    warnings.push(...recon.warnings);

    /* ---------------------------------------------------------------- write */
    const importId = crypto.randomUUID();
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
        statement_to: statementTo,
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
        created_by: caller.kind === 'staff' ? caller.employeeId : null,
        request_id: requestId,
      },
    ]);

    try {
      await sbInsert(cfg, 'cas_folios', rows.folios);
      await sbInsert(cfg, 'cas_schemes', rows.schemes);
      // 1,639 transactions on a since-inception statement is normal; chunked so
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

    /* ------------------------------------------------- close out and notify */
    if (requestId) {
      await sbPatch(cfg, `cas_requests?id=eq.${requestId}`, {
        status: recon.reconciled ? 'imported' : 'failed',
        import_id: importId,
        failure_reason: recon.reconciled ? null : recon.failures.join(' ') || null,
        completed_at: new Date().toISOString(),
      }).catch(() => undefined); // the import stands regardless
    }

    const clientLabel = client.full_name ?? clientId;
    if (!recon.reconciled) {
      // The client is told we could not verify it and shown no figures. The RM
      // is told because a mismatch means the parser met a layout it did not
      // know, and that needs a human to look at the statement.
      await alertRm(cfg, 'reconciliationMismatch', {
        clientId,
        clientLabel,
        detail: `A statement was imported but did not reconcile, so it is not being shown. ${recon.failures.join(' ')}`,
      });
    } else {
      /*
       * Held-away value is read back from the database rather than recomputed
       * here: `cas_schemes.is_ours` is a GENERATED column, so asking Postgres
       * keeps the ARN-matching rule in exactly one place. Costs one round trip
       * on the success path only.
       */
      try {
        const heldAway = await sbSelect<{ value: number | null }>(
          cfg,
          `cas_schemes?select=value&import_id=eq.${importId}` +
            `&is_ours=is.false&advisor_code=not.is.null&value=gt.0`,
        );
        if (heldAway.length) {
          const total = heldAway.reduce((s, r) => s + (Number(r.value) || 0), 0);
          await alertRm(cfg, 'heldAwayDetected', {
            clientId,
            clientLabel,
            detail:
              `${heldAway.length} scheme(s) worth ₹${total.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ` +
              `sit with another distributor.`,
          });
        }
      } catch {
        /* the import succeeded; a missing alert must not change that */
      }
    }

    return json({
      importId,
      clientId,
      duplicate: false,
      status,
      variant: isDetailed ? 'detailed' : 'summary',
      statementFrom: period?.from ?? null,
      statementTo,
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
    if (err instanceof CasError) return json({ error: err.message }, err.httpStatus);
    console.error('[cas] unexpected', err);
    return json({ error: 'The statement could not be imported.' }, 500);
  }
});
