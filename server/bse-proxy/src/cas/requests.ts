/**
 * Tracked CAS requests — the journey around the import, not the import itself.
 *
 * ## What a request is, and what it is not
 *
 * A row in `cas_requests` records that a client set out to import a statement:
 * which period, to which email, at what time. It does NOT mean we asked CAMS for
 * anything, and this module contains no code that could.
 *
 * That is a regulatory boundary, not an unfinished feature. CAMS publishes no
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

interface RequestRow {
  id: string;
  client_id: string;
  status: string;
  requested_email: string | null;
  statement_from: string | null;
  statement_to: string | null;
  statement_type: string | null;
  include_zero_balance: boolean | null;
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
  includeZeroBalance: r.include_zero_balance,
  expectedBy: r.expected_by,
  importId: r.import_id,
  failureReason: r.failure_reason,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

export function casRequestRouter(cfg: ProxyConfig): Router {
  const router = Router();

  /**
   * Start a request.
   *
   * Returns the exact values the client must enter on the CAMS form, taken from
   * their own record rather than asked for again — we already hold their PAN,
   * date of birth and registered email, and making someone retype what we know
   * is both friction and a chance to get it wrong.
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as {
        clientId?: string;
        email?: string;
        statementFrom?: string;
        consents?: string[];
      };
      const clientId = callerClientId(req, body.clientId);

      const [client] = await sbSelect<{
        id: string;
        pan: string | null;
        dob: string | null;
        email: string | null;
        full_name: string | null;
      }>(
        cfg,
        `nw_clients?select=id,pan,dob,email,full_name&id=eq.${encodeURIComponent(clientId)}&limit=1`,
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

      await sbInsert(cfg, 'cas_requests', [
        {
          id: requestId,
          client_id: clientId,
          status: 'awaiting_statement',
          requested_email: requestedEmail,
          // Earliest possible start: a CAS covers everything from inception, and
          // returns computed on a truncated history are simply wrong.
          statement_from: body.statementFrom ?? '1990-01-01',
          statement_to: now.toISOString().slice(0, 10),
          statement_type: 'detailed',
          include_zero_balance: true,
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
          policy_version: 'v1',
          ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null,
          user_agent: String(req.headers['user-agent'] ?? '').slice(0, 500),
          evidence: { surface: 'portal_import_wizard' },
        })),
      );

      res.json({
        requestId,
        status: 'awaiting_statement',
        expectedBy: new Date(now.getTime() + EXPECTED_WITHIN_MS).toISOString(),
        /*
         * What to type on the CAMS form. Sent from the server so the wording of
         * the four choices that decide whether a statement is usable lives in
         * one place, and a client on an old cached bundle cannot be shown stale
         * instructions.
         */
        form: {
          url: 'https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement',
          email: requestedEmail,
          pan: client.pan ?? '',
          dob: client.dob ?? '',
          statementType: 'Detailed',
          period: 'Specific Period — earliest available start date',
          folioListing: 'With zero balance folios',
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
