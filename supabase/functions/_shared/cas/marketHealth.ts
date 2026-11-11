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
  /* On-demand NAV history (mf_nav_tracked), since 2026-11-07. Optional so an
     older view without these columns still type-checks. */
  latest_calendar_nav_date?: string | null;
  tracked_funds?: number;
  tracked_loaded?: number;
  tracked_gave_up_24h?: number;
  tracked_waiting_over_1d?: number;
  /* Client-held funds priced >3 days behind the latest full AMFI day
     (registrar holdings by live_nav_date; ISIN holdings by their newest NAV). */
  held_stale_navs?: number;
  held_stale_sample?: string | null;
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
  // NAV history is loaded on demand for funds clients hold (mf_nav_tracked).
  // Only NEW give-ups are reported, so a fund the source simply has no history
  // for is mentioned once, not every morning.
  const gaveUp = Number(h.tracked_gave_up_24h ?? 0);
  if (gaveUp > 0)
    out.push({ level: 'warning', text: `${gaveUp} client-held fund(s) could not get their NAV history loaded after repeated attempts.` });
  const waiting = Number(h.tracked_waiting_over_1d ?? 0);
  if (waiting > 0)
    out.push({ level: 'warning', text: `${waiting} client-held fund(s) have been waiting over a day for their NAV history to load.` });
  // The failure clients actually see: a fund they hold showing an old price
  // while the feed itself is healthy (registrar funds frozen at the mailback
  // NAV until 2026-11-12). Critical — it is wrong money on a client screen.
  const heldStale = Number(h.held_stale_navs ?? 0);
  if (heldStale > 0)
    out.push({
      level: 'critical',
      text: `${heldStale} client-held fund(s) are priced more than 3 days behind the latest NAV${h.held_stale_sample ? ` (${h.held_stale_sample})` : ''}.`,
    });
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
  const text = `${lines}\n\nLatest full NAV day: ${h.latest_nav_date ?? '—'} (${h.latest_nav_rows ?? 0} ISINs)\nClient funds with NAV history: ${h.tracked_loaded ?? '—'} of ${h.tracked_funds ?? '—'}\n\nNiyom MF market-data health check`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Niyom Wealth <support@niyomwealth.com>', to, subject, text }),
  });
  return res.ok ? 'sent' : `failed-${res.status}`;
}

export async function runMarketHealth(cfg: SbConfig, opts: { test?: boolean } = {}) {
  const startedAt = new Date().toISOString();
  const [h] = await sbSelect<MarketHealthRow>(cfg, 'mf_market_data_health?select=*');
  const problems = h ? assessHealth(h) : [{ level: 'critical' as const, text: 'Health view returned nothing.' }];
  let alert = 'none';
  if (problems.length && h) alert = await sendAlert(problems, h).catch((e) => `failed-${(e as Error).message}`);
  // {test:true}: prove the alert path end to end without waiting for a failure.
  else if (opts.test && h)
    alert = await sendAlert(
      [{ level: 'warning', text: 'TEST — alerts are configured. No action needed; the pipeline is healthy.' }],
      h,
    ).catch((e) => `failed-${(e as Error).message}`);
  await sbInsert(cfg, 'nav_refresh_log', [{
    job: 'health', started_at: startedAt, finished_at: new Date().toISOString(),
    ok: !problems.some((p) => p.level === 'critical'),
    nav_date: h?.latest_nav_date ?? null,
    error: problems.length ? problems.map((p) => p.text).join(' | ').slice(0, 500) : null,
    details: { problems, alert, snapshot: h ?? null },
  }]).catch(() => undefined);
  return { ok: true, problems, alert, health: h ?? null };
}
