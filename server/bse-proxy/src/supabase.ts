/**
 * Minimal Supabase writer — inserts webhook events via PostgREST using the
 * service-role key. No SDK dependency; plain fetch. Best-effort: failures are
 * logged, never thrown into the webhook response (BSE must still get its 200).
 */
import type { ProxyConfig } from './config.js';

export async function insertWebhookEvent(
  cfg: ProxyConfig,
  row: Record<string, unknown>,
): Promise<void> {
  if (!cfg.supabaseServiceRoleKey) {
    console.warn('[webhook] SUPABASE_SERVICE_ROLE_KEY not set — event not persisted');
    return;
  }
  try {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/bse_webhook_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.supabaseServiceRoleKey,
        Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error(`[webhook] Supabase insert failed (${res.status}): ${t.slice(0, 300)}`);
    }
  } catch (err) {
    console.error('[webhook] Supabase insert error', err);
  }
}
