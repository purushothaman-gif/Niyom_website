/**
 * Daily health check of the MF market-data pipeline, with an email alert.
 *
 * Reads public.mf_market_data_health and turns it into a list of problems. A
 * NAV feed that silently stops is the failure that matters most here: clients
 * keep seeing yesterday's (or last week's) value with nothing on screen to say
 * so — that happened for nine days in Aug-2026 and nobody was told.
 *
 * Recipients come from the MF_ALERT_EMAILS function secret (comma-separated).
 * Unset means "log only" — the check still runs and is recorded in
 * nav_refresh_log (job='health'), but nobody is emailed.
 */
import { sbInsert, sbSelect, type SbConfig } from './db.ts';

export interface MarketHealthRow {
  latest_nav_date: string | null;
  nav_age_days: number | null;
  latest_nav_rows: number | null;
  median_nav_rows_14d: number | null;
  last_daily_ok: boolean | null;
  last_daily_error: string | null;
  last_daily_validation: { big_moves?: number; missing_vs_prev?: number } | null;
  last_daily_ok_at: string | null;
  history_cursor: string | null;
  history_floor: string;
  history_failures_24h: number;
  history_windows_skipped: number;
  master_synced_at: string | null;
  returns_stale: number;
  returns_from_nav_daily: number;
}

export interface Problem {
  level: 'critical' | 'warning';
  text: string;
}

/** Pure: the health row -> problems. Exported for tests. */
export function assessHealth(h: MarketHealthRow, now = new Date()): Problem[] {
  const out: Problem[] = [];
  // NAVs are struck on business days; 4 days covers a weekend plus a holiday.
  if (h.nav_age_days == null) out.push({ level: 'critical', text: 'No NAVs at all in the last 30 days.' });
  else if (h.nav_age_days > 4)
    out.push({ level: 'critical', text: `Latest NAV is ${h.nav_age_days} days old (${h.latest_nav_date}).` });
  if (h.last_daily_ok === false)
    out.push({ level: 'critical', text: `Last nightly NAV refresh failed: ${h.last_daily_error ?? 'unknown error'}` });
  if (h.latest_nav_rows != null && h.median_nav_rows_14d && h.latest_nav_rows < 0.9 * h.median_nav_rows_14d)
    out.push({
      level: 'warning',
      text: `Latest NAV date has ${h.latest_nav_rows} ISINs vs a 14-day median of ${h.median_nav_rows_14d} — AMFI file may be partial.`,
    });
  const big = h.last_daily_validation?.big_moves ?? 0;
  if (big > 25) out.push({ level: 'warning', text: `${big} schemes moved more than 20% in one day — check for bad NAVs.` });
  if (h.history_failures_24h >= 10)
    out.push({ level: 'warning', text: `NAV history backfill failed ${h.history_failures_24h} times in 24h.` });
  if (h.history_windows_skipped > 0)
    out.push({ level: 'warning', text: `${h.history_windows_skipped} history week(s) were skipped after repeated failures — gaps exist.` });
  const masterAgeH = h.master_synced_at ? (now.getTime() - new Date(h.master_synced_at).getTime()) / 3.6e6 : null;
  if (masterAgeH == null || masterAgeH > 72)
    out.push({ level: 'warning', text: 'AMFI scheme master has not synced in over 3 days.' });
  if (h.returns_stale > 500)
    out.push({ level: 'warning', text: `${h.returns_stale} live schemes have returns older than 3 days.` });
  return out;
}

async function sendAlert(problems: Problem[], h: MarketHealthRow): Promise<string> {
  const key = Deno.env.get('RESEND_API_KEY');
  const to = (Deno.env.get('MF_ALERT_EMAILS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!key || !to.length) return 'not-configured';
  const crit = problems.some((p) => p.level === 'critical');
  const subject = `${crit ? '[ACTION] ' : ''}MF market data: ${problems.length} issue${problems.length > 1 ? 's' : ''}`;
  const lines = problems.map((p) => `• [${p.level}] ${p.text}`).join('\n');
  const text = `${lines}\n\nLatest NAV date: ${h.latest_nav_date ?? '—'}\nHistory backfill reached: ${h.history_cursor ?? 'not started'}\n\nNiyom MF market-data health check`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Niyom Wealth <support@niyomwealth.com>', to, subject, text }),
  });
  return res.ok ? 'sent' : `failed-${res.status}`;
}

export async function runMarketHealth(cfg: SbConfig) {
  const startedAt = new Date().toISOString();
  const [h] = await sbSelect<MarketHealthRow>(cfg, 'mf_market_data_health?select=*');
  const problems = h ? assessHealth(h) : [{ level: 'critical' as const, text: 'Health view returned nothing.' }];
  let alert = 'none';
  if (problems.length && h) alert = await sendAlert(problems, h).catch((e) => `failed-${(e as Error).message}`);
  await sbInsert(cfg, 'nav_refresh_log', [{
    job: 'health', started_at: startedAt, finished_at: new Date().toISOString(),
    ok: !problems.some((p) => p.level === 'critical'),
    nav_date: h?.latest_nav_date ?? null,
    error: problems.length ? problems.map((p) => p.text).join(' | ').slice(0, 500) : null,
    details: { problems, alert, snapshot: h ?? null },
  }]).catch(() => undefined);
  return { ok: true, problems, alert, health: h ?? null };
}
