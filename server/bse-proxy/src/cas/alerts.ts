/**
 * Relationship-manager alerts for the CAS pipeline.
 *
 * ## Why these fire from here and not from a database trigger
 *
 * The obvious place is a Postgres trigger on cas_imports. It is the wrong place:
 * the `app.settings.*` GUCs this project's pg_cron→edge-function jobs depend on
 * are unset, so those jobs fail silently. An alert that silently does not fire
 * is worse than no alert, because nobody goes looking for it. The proxy already
 * holds the service role and is already in the request path, so it can write the
 * row and know whether it worked.
 *
 * ## Why every call is best-effort
 *
 * These are notifications about an import, never part of one. A failure to tell
 * an RM something must not turn a client's successful import into an error, nor
 * a failed import into a 500 that hides the real reason. Everything here catches
 * and logs.
 *
 * Alerts route to the client's own RM (`nw_clients.employee_id`). A client with
 * no RM assigned produces no alert rather than a broadcast.
 */
import type { ProxyConfig } from '../config.js';
import { sbInsert, sbSelect } from './db.js';

/**
 * The conditions worth interrupting an RM for. Titles live here rather than at
 * the call sites so the console shows one consistent vocabulary.
 */
export const CAS_ALERTS = {
  importFailed: 'Portfolio import failed',
  panMismatch: 'Statement PAN does not match client',
  reconciliationMismatch: 'Statement could not be verified',
  staleStatement: 'Client portfolio statement is out of date',
  heldAwayDetected: 'Held-away assets detected',
  requestStalled: 'Client started a portfolio import but never finished',
} as const;

export type CasAlertKind = keyof typeof CAS_ALERTS;

/**
 * Notify the client's RM. Never throws.
 *
 * `clientLabel` is passed in rather than looked up because every caller already
 * has the client row — and an alert that costs an extra round trip is an alert
 * that will eventually be dropped for latency.
 */
export async function alertRm(
  cfg: ProxyConfig,
  kind: CasAlertKind,
  args: { clientId: string; clientLabel: string; detail: string },
): Promise<void> {
  try {
    const [client] = await sbSelect<{ employee_id: string | null }>(
      cfg,
      `nw_clients?select=employee_id&id=eq.${encodeURIComponent(args.clientId)}&limit=1`,
    );
    const employeeId = client?.employee_id;
    // No RM assigned: stay quiet rather than alerting everyone.
    if (!employeeId) return;

    await sbInsert(cfg, 'nw_alerts', [
      {
        employee_id: employeeId,
        title: CAS_ALERTS[kind],
        message: `${args.clientLabel}: ${args.detail}`,
      },
    ]);
  } catch (err) {
    console.error(`[cas] alert '${kind}' not delivered:`, (err as Error)?.message);
  }
}
