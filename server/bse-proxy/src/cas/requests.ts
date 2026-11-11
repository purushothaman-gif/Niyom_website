/**
 * Tracked CAS requests — the journey around the import, not the import itself.
 *
 * ## What a request is, and what it is not
 *
 * A row in `cas_requests` records that a client set out to import a statement:
 * which period, to which email, at what time. By default it does NOT mean we
 * asked CAMS for anything.
 *
 * One exception, added 2026-11-11 and off unless configured: when the client
 * has agreed to the v2 consent wording, the request is placed for them through
 * a vendor's mailback API (see generator.ts). This module still never drives
 * the registrar's website, and the statement is still emailed only to the
 * investor.
 *
 * The background that made the guided flow the default: CAMS publishes no
 * distributor-facing CAS API; MF Central's was withdrawn from third-party apps
 * by AMFI in September 2025; and the Account Aggregator route requires the
 * requesting entity to be regulated by RBI/SEBI/IRDAI/PFRDA, which an AMFI ARN
 * is not. Requesting a statement is the investor's act. Anything else — driving
 * their session, replaying the form, handling their OTP — is impersonation with
 * extra steps.
 *
 * ## So what does tracking buy?
 *
 * Everything after the request. We know a statement is expected, so we can show
 * a live status instead of a dead end, chase it when nothing arrives, tell the
 * RM when a client stalled halfway, and link the eventual import back to the
 * intent that produced it. The client's four minutes on camsonline.com stay
 * theirs; the twenty minutes of confusion around it do not have to.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ProxyConfig } from '../config.js';
import { CasError, sbInsert, sbPatch, sbSelect } from './db.js';
import { randomUUID } from 'node:crypto';
import { isAcceptablePassword, mailbackEnabled, requestCasMailback } from './generator.js';

/**
 * Consent wording versions. v1 says the client requests the statement
 * themselves; v2 says we place the request for them through a service
 * provider. An automatic request is only ever made against v2 — the version is
 * what proves the client was told.
 */
const POLICY_GUIDED = 'v1';
const POLICY_AUTO = 'v2';

/** Requests per client per rolling day once we are the ones placing them. */
const MAX_AUTO_PER_DAY = 4;

/**
 * How long we wait before treating a statement as lost.
 *
 * CAMS delivers in about five minutes. Six hours is deliberately far more than
 * that: the cost of waiting too long is a slightly stale status, and the cost of
 * giving up too early is telling a client their request failed while the email
 * is still in flight.
 */
const EXPECTED_WITHIN_MS = 6 * 60 * 60 * 1000;

/** The consents a client may grant. Mirrors src/portal/types/consent.ts. */
const CONSENT_TYPES = [
  'cas_request',
  'email_read',
  'temp_storage',
  'portfolio_import',
  'arn_migration',
] as const;
type ConsentType = (typeof CONSENT_TYPES)[number];

const OPEN_STATUSES = ['draft', 'awaiting_statement', 'received'];

/**
 * The earliest start date we ask for.
 *
 * A CAS must cover the client's whole history or the returns computed from it
 * are simply wrong, and CAMS has no "since inception" option — only a date. The
 * Indian mutual fund industry predates this by decades in principle, but no
 * retail folio does, so it is early enough to mean "everything" while still
 * being a date the form will accept.
 */
const EARLIEST_FROM = '1990-01-01';

/**
 * Which folio listing we ask for, and the stored key for it.
 *
 * "Without zero balance folios" — the page's own default, and a business
 * decision (2026-11-11): the import exists to show what a client holds today,
 * and exited folios add pages of history for funds that are no longer there.
 *
 * The cost is known and accepted: a folio the client has fully redeemed is not
 * in the statement at all, so realised capital gains from those folios cannot
 * be computed from it. Anything that needs them must ask for a different
 * listing rather than assume this one is complete.
 */
const FOLIO_LISTING = {
  key: 'without_zero_balance',
  label: 'Without zero balance folios',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1990-01-01" -> "01-Jan-1990", the format the CAMS date fields display. */
function toCamsDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${d}-${month}-${y}` : iso;
}

interface RequestRow {
  id: string;
  client_id: string;
  status: string;
  requested_email: string | null;
  statement_from: string | null;
  statement_to: string | null;
  statement_type: string | null;
  folio_listing: string | null;
  expected_by: string | null;
  import_id: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

/** The client this caller may act for. Never taken from the request body. */
function callerClientId(req: Request, bodyClientId?: string): string {
  const caller = req.caller;
  if (!caller) throw new CasError('Caller not resolved.', 401);
  const id = caller.kind === 'staff' ? String(bodyClientId ?? '').trim() : (caller.clientId ?? '');
  if (!id) {
    throw new CasError(
      caller.kind === 'staff'
        ? 'A client is required — say whose request this is.'
        : 'Your client record could not be found.',
      caller.kind === 'staff' ? 400 : 403,
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CasError('That is not a valid client id.', 400);
  return id;
}

const toApi = (r: RequestRow) => ({
  requestId: r.id,
  status: r.status,
  requestedEmail: r.requested_email,
  statementFrom: r.statement_from,
  statementTo: r.statement_to,
  statementType: r.statement_type,
  folioListing: r.folio_listing,
  expectedBy: r.expected_by,
  importId: r.import_id,
  failureReason: r.failure_reason,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

export function casRequestRouter(cfg: ProxyConfig): Router {
  const router = Router();

  /**
   * Whether this server can place requests itself. Asked before the consent
   * screen, because which wording the client must be shown depends on it.
   */
  router.get('/mode', (_req: Request, res: Response) => {
    res.json({ autoSubmit: mailbackEnabled(cfg), policyVersion: mailbackEnabled(cfg) ? POLICY_AUTO : POLICY_GUIDED });
  });

  /**
   * Start a request.
   *
   * Returns the exact values the client must enter on the CAMS form, taken from
   * their own record rather than asked for again — we already hold their PAN and
   * registered email, and making someone retype what we know is both friction
   * and a chance to get it wrong.
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as {
        clientId?: string;
        email?: string;
        statementFrom?: string;
        consents?: string[];
        /** The wording the client was shown. Only 'v2' permits an automatic request. */
        policyVersion?: string;
        /** One-time PDF password, generated in the browser. Never stored. */
        password?: string;
      };
      const clientId = callerClientId(req, body.clientId);

      const [client] = await sbSelect<{
        id: string;
        pan: string | null;
        email: string | null;
        full_name: string | null;
      }>(
        cfg,
        `nw_clients?select=id,pan,email,full_name&id=eq.${encodeURIComponent(clientId)}&limit=1`,
      );
      if (!client) throw new CasError('That client does not exist.', 404);

      /*
       * Requesting a statement and importing it are separate authorisations and
       * both are required to get this far. Email reading is NOT required here —
       * a client may track a request and still upload by hand.
       */
      const granted = new Set((body.consents ?? []).filter((c): c is ConsentType =>
        (CONSENT_TYPES as readonly string[]).includes(c),
      ));
      for (const required of ['cas_request', 'portfolio_import'] as const) {
        if (!granted.has(required)) {
          throw new CasError('Please confirm the permissions before we continue.', 400);
        }
      }

      // Statements are consolidated by EMAIL, so this is the one field worth
      // letting the client override — their funds may sit under an older address.
      const requestedEmail = (body.email ?? client.email ?? '').trim();
      if (!/^\S+@\S+\.\S+$/.test(requestedEmail)) {
        throw new CasError('A valid email address is required to receive the statement.', 400);
      }

      const now = new Date();
      const requestId = randomUUID();
      const fromDate = body.statementFrom ?? EARLIEST_FROM;
      const toDate = now.toISOString().slice(0, 10);

      /*
       * Automatic only when all three hold: the server is configured for it,
       * the client was shown the wording that says we will do it, and there is
       * a usable password. Anything less quietly stays guided — an older app
       * build that knows nothing of this keeps working exactly as before.
       */
      const password = typeof body.password === 'string' ? body.password : '';
      const auto =
        mailbackEnabled(cfg) && body.policyVersion === POLICY_AUTO && password.length > 0;
      if (auto && !isAcceptablePassword(password)) {
        throw new CasError('That password does not meet the registrar’s rules.', 400);
      }
      if (auto && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
        throw new CasError('That start date is not valid.', 400);
      }
      if (auto) {
        /*
         * Each automatic request costs money and sends a registrar email to
         * whatever address was typed. A client retrying a wrong address needs a
         * few goes; nobody needs more than that in a day.
         */
        const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const recent = await sbSelect<{ id: string }>(
          cfg,
          `cas_requests?select=id&client_id=eq.${encodeURIComponent(clientId)}` +
            `&created_at=gte.${encodeURIComponent(since)}&limit=${MAX_AUTO_PER_DAY}`,
        );
        if (recent.length >= MAX_AUTO_PER_DAY) {
          throw new CasError(
            'You have requested a statement several times today. Please try again tomorrow, or ask your relationship manager for help.',
            429,
          );
        }
      }

      await sbInsert(cfg, 'cas_requests', [
        {
          id: requestId,
          client_id: clientId,
          status: 'awaiting_statement',
          requested_email: requestedEmail,
          statement_from: fromDate,
          statement_to: toDate,
          statement_type: 'detailed',
          // The vendor API has no folio-listing option; do not claim one.
          folio_listing: auto ? 'vendor_default' : FOLIO_LISTING.key,
          expected_by: new Date(now.getTime() + EXPECTED_WITHIN_MS).toISOString(),
          created_by: req.caller?.kind === 'staff' ? (req.caller.employeeId ?? null) : null,
        },
      ]);

      /*
       * Consent is recorded server-side with the IP and user agent the request
       * actually arrived on. A browser cannot write these tables, so it cannot
       * manufacture a consent record — which is the point of storing them here
       * rather than trusting a flag from the client.
       */
      await sbInsert(
        cfg,
        'cas_consents',
        [...granted].map((consent_type) => ({
          client_id: clientId,
          request_id: requestId,
          consent_type,
          granted: true,
          policy_version: auto ? POLICY_AUTO : POLICY_GUIDED,
          ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null,
          user_agent: String(req.headers['user-agent'] ?? '').slice(0, 500),
          evidence: {
            surface: 'portal_import_wizard',
            channel: auto ? 'vendor_mailback' : 'guided_form',
          },
        })),
      );

      if (auto) {
        try {
          await requestCasMailback(cfg, {
            email: requestedEmail,
            pan: client.pan,
            fromDate,
            toDate,
            password,
          });
        } catch (err) {
          // Nothing is on its way, so the request must not sit there looking
          // as though something is.
          await sbPatch(cfg, `cas_requests?id=eq.${requestId}`, {
            status: 'failed',
            failure_reason: 'Automatic request was not accepted.',
          }).catch(() => undefined);
          throw err;
        }
      }

      res.json({
        requestId,
        status: 'awaiting_statement',
        expectedBy: new Date(now.getTime() + EXPECTED_WITHIN_MS).toISOString(),
        /** True when we placed the request; the client has nothing to fill in. */
        submitted: auto,
        /*
         * What to enter on the CAMS form, in the form's own field order and
         * using its own labels. Sent from the server so the choices that decide
         * whether a statement is usable live in one place, and a client on a
         * stale bundle cannot be shown instructions we have since corrected.
         *
         * Only fields the form actually has. Anything else is noise a client
         * has to mentally discard while working through a page that already
         * asks a lot of them.
         */
        form: {
          url: 'https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement',
          statementType: 'Detailed',
          period: 'Specific Period',
          fromDate: toCamsDate(fromDate),
          toDate: toCamsDate(toDate),
          folioListing: FOLIO_LISTING.label,
          email: requestedEmail,
          pan: client.pan ?? '',
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /** The client's most recent request, for the awaiting screen to poll. */
  router.get('/latest', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = callerClientId(req, String(req.query.clientId ?? ''));
      const [row] = await sbSelect<RequestRow>(
        cfg,
        `cas_requests?select=*&client_id=eq.${encodeURIComponent(clientId)}` +
          `&order=created_at.desc&limit=1`,
      );
      if (!row) return res.json(null);

      /*
       * Expiry is decided when someone looks, not by a background sweep. A
       * status that is only correct if a cron job ran is a status that will
       * eventually lie, and this one is read far more often than it changes.
       */
      if (OPEN_STATUSES.includes(row.status) && row.expected_by && row.expected_by < new Date().toISOString()) {
        await sbPatch(cfg, `cas_requests?id=eq.${row.id}`, { status: 'expired' }).catch(() => undefined);
        row.status = 'expired';
      }
      res.json(toApi(row));
    } catch (err) {
      next(err);
    }
  });

  /** Client changed their mind, or wants to start again with a different email. */
  router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = callerClientId(req, (req.body as { clientId?: string })?.clientId);
      const id = req.params.id;
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new CasError('That is not a valid request.', 400);

      // Scoped by client_id as well as id: a request id alone must never be
      // enough to touch someone else's row.
      const [row] = await sbSelect<RequestRow>(
        cfg,
        `cas_requests?select=id,status&id=eq.${id}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
      );
      if (!row) throw new CasError('That request could not be found.', 404);
      if (!OPEN_STATUSES.includes(row.status)) {
        return res.json({ requestId: id, status: row.status, message: 'Already closed.' });
      }

      await sbPatch(cfg, `cas_requests?id=eq.${id}`, {
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      });
      res.json({ requestId: id, status: 'cancelled' });
    } catch (err) {
      next(err);
    }
  });

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CasError) return res.status(err.httpStatus).json({ error: err.message });
    console.error('[cas/requests] unexpected', err);
    return res.status(500).json({ error: 'Something went wrong starting your import.' });
  });

  return router;
}
