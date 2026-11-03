/**
 * AMFI scheme master → mf_asset_class.
 *
 * AMFI's scheme-data file (DownloadSchemeData_Po.aspx?mf=0) lists every scheme
 * code of every AMC, live and closed, one row per plan/option:
 *
 *   AMC,Code,Scheme Name,Scheme Type,Scheme Category,Scheme NAV Name,
 *   Scheme Minimum Amount,Launch Date, Closure Date,
 *   ISIN Div Payout/ ISIN GrowthISIN Div Reinvestment
 *
 * The last column is BOTH ISINs run together with no delimiter (and sometimes
 * a stray character), so ISINs are pulled out by pattern, never by position.
 *
 * mf_asset_class is ISIN-keyed and already written nightly by nav-refresh with
 * the category HEADING and the derived asset class, which fix a holding's tax
 * treatment. This job only adds descriptive master columns. For ISINs the
 * nightly file has never listed (mostly closed schemes) it also inserts the
 * classification, derived from the same SEBI category text by the same
 * classifier, so a closed fund in an old CAS is classified rather than absent.
 * Existing rows' classification and admin overrides are never touched.
 */
import { parseCsv } from '../rta/csv.ts';
import { classifyCategory } from './assetClass.ts';
import { sbInsert, sbSelect, type SbConfig } from './db.ts';

export const SCHEME_MASTER_URL = 'https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0';

const ISIN_G = /INF[A-Z0-9]{9}/g;

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function toIso(d: string | undefined): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((d ?? '').trim());
  const mm = m ? MONTHS[m[2].toLowerCase()] : null;
  return m && mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : null;
}

export function planOf(navName: string): 'Direct' | 'Regular' {
  return /\bdirect\b/i.test(navName) ? 'Direct' : 'Regular';
}

export function optionOf(navName: string): 'Growth' | 'IDCW' | 'Bonus' {
  if (/\bbonus\b/i.test(navName)) return 'Bonus';
  if (/idcw|dividend|\bdiv\b|payout|reinvest/i.test(navName)) return 'IDCW';
  return 'Growth';
}

export interface SchemeMasterRow {
  isin: string;
  amfi_code: string;
  scheme_name: string;
  amc_name: string;
  scheme_base_name: string;
  scheme_type: string | null;
  sebi_category: string | null;
  plan: string;
  scheme_option: string;
  min_amount: number | null;
  launch_date: string | null;
  closure_date: string | null;
}

/** Find a column by header text, tolerant of AMFI's spacing. */
function col(header: string[], re: RegExp): string | null {
  return header.find((h) => re.test(h.replace(/\s+/g, ' '))) ?? null;
}

export function parseSchemeMaster(data: Uint8Array): SchemeMasterRow[] {
  const { header, rows } = parseCsv(data);
  const cAmc = col(header, /^AMC$/i);
  const cCode = col(header, /^Code$/i);
  const cName = col(header, /^Scheme Name$/i);
  const cType = col(header, /^Scheme Type$/i);
  const cCat = col(header, /^Scheme Category$/i);
  const cNav = col(header, /^Scheme NAV Name$/i);
  const cMin = col(header, /Minimum Amount/i);
  const cLaunch = col(header, /^Launch Date$/i);
  const cClose = col(header, /^Closure Date$/i);
  const cIsin = col(header, /ISIN/i);
  if (!cCode || !cNav || !cIsin) throw new Error('AMFI scheme-data file layout not recognised');

  const out: SchemeMasterRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const code = (r[cCode] ?? '').trim();
    const navName = (r[cNav] ?? '').trim();
    if (!code || !navName) continue;
    const isins = ((r[cIsin] ?? '').toUpperCase().match(ISIN_G) ?? []);
    const min = Number((cMin ? r[cMin] : '')?.replace(/[^0-9.]/g, ''));
    for (const isin of isins) {
      if (seen.has(isin)) continue;
      seen.add(isin);
      out.push({
        isin,
        amfi_code: code,
        scheme_name: navName,
        amc_name: (cAmc ? r[cAmc] : '').trim(),
        scheme_base_name: (cName ? r[cName] : '').trim(),
        scheme_type: (cType ? r[cType] : '').trim() || null,
        sebi_category: (cCat ? r[cCat] : '').replace(/\s+/g, ' ').trim() || null,
        plan: planOf(navName),
        scheme_option: optionOf(navName),
        min_amount: Number.isFinite(min) && min > 0 ? min : null,
        launch_date: toIso(cLaunch ? r[cLaunch] : ''),
        closure_date: toIso(cClose ? r[cClose] : ''),
      });
    }
  }
  return out;
}

export interface MasterRunResult {
  ok: boolean;
  parsed: number;
  updated: number;
  inserted: number;
  error?: string;
}

export async function refreshSchemeMaster(cfg: SbConfig): Promise<MasterRunResult> {
  const startedAt = new Date().toISOString();
  let parsed = 0;
  let updated = 0;
  let inserted = 0;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90_000);
    const res = await fetch(SCHEME_MASTER_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
    const rows = parseSchemeMaster(new Uint8Array(await res.arrayBuffer()));
    parsed = rows.length;
    if (parsed < 5000) throw new Error(`AMFI scheme-data file had only ${parsed} ISINs — refusing a partial master`);

    const known = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const page = await sbSelect<{ isin: string }>(cfg, `mf_asset_class?select=isin&order=isin&limit=1000&offset=${offset}`);
      for (const p of page) known.add(p.isin);
      if (page.length < 1000) break;
    }

    const now = new Date().toISOString();
    // Existing ISINs: master columns only, so classification/overrides stay.
    const existing = rows
      .filter((r) => known.has(r.isin))
      .map(({ isin, amc_name, scheme_base_name, scheme_type, sebi_category, plan, scheme_option, min_amount, launch_date, closure_date }) => ({
        isin, amc_name, scheme_base_name, scheme_type, sebi_category, plan, scheme_option, min_amount, launch_date, closure_date,
        master_synced_at: now,
      }));
    // New ISINs: full row, classified from the SEBI category.
    const fresh = rows
      .filter((r) => !known.has(r.isin))
      .map((r) => {
        const c = r.sebi_category ? classifyCategory(r.sebi_category) : null;
        return {
          ...r,
          amfi_category: c?.amfiCategory ?? null,
          asset_class: c?.assetClass ?? null,
          ambiguous: c?.ambiguous ?? true,
          master_synced_at: now,
          updated_at: now,
        };
      });

    for (let i = 0; i < existing.length; i += 1000) {
      await sbInsert(cfg, 'mf_asset_class?on_conflict=isin', existing.slice(i, i + 1000), {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      });
      updated += Math.min(1000, existing.length - i);
    }
    for (let i = 0; i < fresh.length; i += 1000) {
      await sbInsert(cfg, 'mf_asset_class?on_conflict=isin', fresh.slice(i, i + 1000), {
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      });
      inserted += Math.min(1000, fresh.length - i);
    }

    await sbInsert(cfg, 'nav_refresh_log', [{
      job: 'master', started_at: startedAt, finished_at: new Date().toISOString(), ok: true,
      rows_parsed: parsed, rows_written: updated + inserted, details: { updated, inserted },
    }]);
    return { ok: true, parsed, updated, inserted };
  } catch (err) {
    const message = ((err as Error)?.message ?? 'unknown').slice(0, 500);
    await sbInsert(cfg, 'nav_refresh_log', [{
      job: 'master', started_at: startedAt, finished_at: new Date().toISOString(), ok: false,
      rows_parsed: parsed, rows_written: updated + inserted, error: message,
    }]).catch(() => undefined);
    return { ok: false, parsed, updated, inserted, error: message };
  }
}
