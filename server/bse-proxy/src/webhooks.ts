/**
 * BSE StAR MF webhook receiver.
 * -----------------------------------------------------------------------------
 * BSE POSTs status callbacks (UCC / ORDER / SXP / MANDATES / PAYMENT GATEWAY)
 * to this PUBLIC endpoint — it must NOT sit behind the Supabase-JWT gate, since
 * the caller is BSE, not a portal user. Every call returns HTTP 200 with the
 * documented `webhook_ack` object; the event is best-effort persisted to
 * Supabase. BSE retries 3x over 30 min on any non-200.
 */
import { Router, type Request, type Response } from 'express';
import type { ProxyConfig } from './config.js';
import { insertWebhookEvent } from './supabase.js';

/** webhook_ack id: YYYYMMDD-[azAZ09]{8} per the BSE spec (7.3.72). */
function ackId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${ymd}-${s}`;
}

export function webhookRouter(cfg: ProxyConfig): Router {
  const router = Router();

  router.post('/starmf', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const action = (body.action ?? {}) as Record<string, any>;
    const sourceIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';

    // Optional allowlist (comma-separated). Empty = allow all (log only).
    if (cfg.webhookAllowedIps.length && !cfg.webhookAllowedIps.includes(sourceIp)) {
      console.warn(`[webhook] rejected source ip=${sourceIp}`);
      return res.status(403).json({ error: 'Source not allowed' });
    }

    console.log(
      `[webhook] ${action.event_type ?? '?'}/${action.event ?? '?'} ` +
        `req=${body.request_id ?? '-'} client=${body.investor?.client_code ?? '-'} ip=${sourceIp}`,
    );

    // Best-effort persist; never blocks the 200.
    await insertWebhookEvent(cfg, {
      request_id: body.request_id ?? null,
      member_id: body.member?.member_id ?? null,
      client_code: body.investor?.client_code ?? null,
      event_type: action.event_type ?? null,
      event: action.event ?? null,
      msgcode: action.msgcode ?? null,
      order_id: action.order_id ?? null,
      mem_ord_ref_id: action.mem_ord_ref_id ?? null,
      sxp_reg_num: action.sxp_reg_num ?? null,
      mandate_id: action.mandate_id ?? null,
      event_at: action.at ?? null,
      source_ip: sourceIp || null,
      payload: body,
    });

    return res.status(200).json({ status: 'success', data: { id: ackId() }, messages: [] });
  });

  return router;
}
