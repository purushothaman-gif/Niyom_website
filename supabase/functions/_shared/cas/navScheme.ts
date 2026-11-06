/**
 * Full NAV history for ONE scheme, on demand.
 *
 * nav_daily keeps full history only for funds somebody holds (mf_nav_tracked,
 * migration 20261107010000). When a fund first appears — a CAS upload, the
 * registrar feed, a CRM holding, a deal — a trigger asks for its history and
 * this loads it.
 *
 * ## Why mfapi.in and not AMFI's history report
 *
 * AMFI serves history by DATE (every scheme for a day), which is what the old
 * universe backfill walked. For one scheme that means thousands of requests.
 * mfapi.in mirrors the same AMFI NAVs keyed by AMFI scheme code and returns a
 * scheme's whole life in one response. AMFI's own daily rows always win: the
 * insert ignores dates nav_daily already has.
 */
import { sbInsert, sbRpc, sbSelect, type SbConfig } from './db.ts';

const ISIN = /^INF[A-Z0-9]{9}$/;
const FETCH_TIMEOUT_MS = 25_000;

export interface SchemeHistoryResult {
  isin: string;
  ok: boolean;
  amfi_code?: string | null;
  rows?: number;
  first_date?: string | null;
  error?: string;
}

/** mfapi.in "dd-mm-yyyy" → ISO "yyyy-mm-dd"; null if malformed. */
export function mfapiDateToIso(d: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d?.trim() ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** mfapi.in payload → nav_daily rows (positive NAVs, valid dates, one per date). */
export function mfapiToNavRows(
  isin: string,
  amfiCode: string,
  data: { date: string; nav: string }[],
): { isin: string; nav_date: string; nav: number; amfi_code: string }[] {
  const seen = new Set<string>();
  const out: { isin: string; nav_date: string; nav: number; amfi_code: string }[] = [];
  for (const p of data ?? []) {
    const iso = mfapiDateToIso(p?.date);
    const nav = Number(p?.nav);
    if (!iso || !Number.isFinite(nav) || nav <= 0 || seen.has(iso)) continue;
    seen.add(iso);
    out.push({ isin, nav_date: iso, nav, amfi_code: amfiCode });
  }
  return out;
}

async function amfiCodeFor(cfg: SbConfig, isin: string): Promise<string | null> {
  const a = await sbSelect<{ amfi_code: string | null }>(
    cfg, `mf_asset_class?select=amfi_code&isin=eq.${isin}&amfi_code=not.is.null&limit=1`);
  if (a[0]?.amfi_code) return a[0].amfi_code;
  const n = await sbSelect<{ amfi_code: string | null }>(
    cfg, `nav_daily?select=amfi_code&isin=eq.${isin}&amfi_code=not.is.null&order=nav_date.desc&limit=1`);
  return n[0]?.amfi_code ?? null;
}

async function loadOne(cfg: SbConfig, isin: string): Promise<SchemeHistoryResult> {
  try {
    const code = await amfiCodeFor(cfg, isin);
    if (!code) throw new Error('no AMFI scheme code known for this ISIN');

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`, { signal: ctl.signal })
      .finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`mfapi.in answered ${res.status}`);
    const body = (await res.json()) as { data?: { date: string; nav: string }[] };
    const rows = mfapiToNavRows(isin, code, body.data ?? []);
    if (!rows.length) throw new Error('mfapi.in returned no history');

    for (let i = 0; i < rows.length; i += 2000) {
      await sbInsert(cfg, 'nav_daily?on_conflict=isin,nav_date', rows.slice(i, i + 2000), {
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      });
    }
    const first = rows.reduce((m, r) => (r.nav_date < m ? r.nav_date : m), rows[0].nav_date);
    await sbRpc(cfg, 'mf_nav_tracked_result', {
      p_isin: isin, p_ok: true, p_first_date: first, p_rows: rows.length, p_error: null,
    });
    return { isin, ok: true, amfi_code: code, rows: rows.length, first_date: first };
  } catch (err) {
    const message = ((err as Error)?.name === 'AbortError' ? 'mfapi.in timed out' : (err as Error)?.message) ?? 'unknown';
    await sbRpc(cfg, 'mf_nav_tracked_result', {
      p_isin: isin, p_ok: false, p_first_date: null, p_rows: null, p_error: message,
    }).catch(() => undefined);
    return { isin, ok: false, error: message };
  }
}

/** Load history for up to 10 ISINs, two at a time (mfapi.in is a free service). */
export async function loadSchemeHistories(cfg: SbConfig, isins: unknown[]): Promise<SchemeHistoryResult[]> {
  const list = [...new Set(isins.map((i) => String(i ?? '').trim().toUpperCase()).filter((i) => ISIN.test(i)))]
    .slice(0, 10);
  const out: SchemeHistoryResult[] = [];
  for (let i = 0; i < list.length; i += 2) {
    out.push(...(await Promise.all(list.slice(i, i + 2).map((isin) => loadOne(cfg, isin)))));
  }
  return out;
}
