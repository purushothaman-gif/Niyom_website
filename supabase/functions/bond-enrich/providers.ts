// Provider-adapter framework. The orchestrator only ever iterates the registry —
// it never names a provider. Add/remove a source by adding/removing an adapter
// file here; business logic is untouched. Concrete adapters are isolated so a
// licensed feed, an exchange API, or a different aggregator can slot in.

import type { ProviderFlow } from './analytics.ts';
import { harmoneyProvider } from './harmoney.ts';

export type Tier = 'official' | 'licensed' | 'public' | 'manual';

export interface Field { value: unknown; confidence: number }
export interface ProviderResult {
  ok: boolean;
  fields: Record<string, Field>;          // normalized bm_bonds field → value + confidence
  redemption_schedule?: { date: string; pct: number }[]; // contractual principal repayment
  cashflows?: ProviderFlow[];               // AUTHORITATIVE full schedule incl. record dates (licensed feeds only)
  source_ref?: Record<string, unknown>;     // provider's own ids, kept for later calls (e.g. instrument_id)
  error?: string;
  http?: number;
}
export interface BondDataProvider {
  id: string;
  label: string;
  tier: Tier;
  priority: number;    // higher wins ties in the merge
  enabled: boolean;
  fetchByISIN(isin: string): Promise<ProviderResult>;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const TIMEOUT_MS = 12000;

function s(v: unknown): string { return String(v ?? '').trim(); }
function normDate(v: unknown): string | null {
  const t = s(v); if (!t) return null;
  const iso = t.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { return iso.startsWith('1900') ? null : iso; }
  return null;
}
function normFreq(v: unknown): string {
  const t = s(v).toLowerCase();
  if (t.includes('month')) return 'monthly';
  if (t.includes('quart') || t.includes('quater')) return 'quarterly';
  if (t.includes('half') || t.includes('semi')) return 'half_yearly';
  if (t.includes('annual') || t.includes('year')) return 'annual';
  return '';
}
function normCouponType(v: unknown): string {
  const t = s(v).toLowerCase();
  if (t.includes('float')) return 'floating';
  if (t.includes('zero')) return 'zero';
  if (t.includes('fix')) return 'fixed';
  return t ? 'fixed' : '';
}
function num(v: unknown): number | null { const n = parseFloat(s(v).replace(/[, ]/g, '')); return Number.isFinite(n) ? n : null; }

// ---------------------------------------------------------------------------
// Adapter: public aggregator (SSR-embedded bond master by ISIN). Isolated here —
// the only place any specific source URL/parse lives.
// ---------------------------------------------------------------------------
const aggregatorProvider: BondDataProvider = {
  id: 'aggregator-public-in',
  label: 'Public bond aggregator (IN)',
  tier: 'public',
  priority: 40,
  enabled: true,
  async fetchByISIN(isin: string): Promise<ProviderResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const url = `https://www.bondsindia.com/bond-directory/bonddetail/${encodeURIComponent(isin)}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: ctrl.signal });
      const http = res.status;
      if (!res.ok) return { ok: false, fields: {}, error: `HTTP ${http}`, http };
      const html = await res.text();
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) return { ok: false, fields: {}, error: 'No embedded data', http };
      const json = JSON.parse(m[1]);
      const p = json?.props?.pageProps ?? {};
      const md = (p.newData && p.newData[0]) ? p.newData[0] : null;
      if (!md) return { ok: false, fields: {}, error: 'No master in payload', http };

      // Confidence for a directly-present public field.
      const C = 85;
      const f: Record<string, Field> = {};
      const put = (k: string, v: unknown, conf = C) => {
        if (v === null || v === undefined || v === '' ) return;
        f[k] = { value: v, confidence: conf };
      };
      put('issuer_name', s(md.Issuer_Name || md.ISIN_NAME));
      put('bond_name', s(md.Security_Short_Name || md.ISIN_NAME));
      put('security_description', s(md.Nature));
      put('coupon_rate', num(md.Coupon_Rate_Actual ?? md.Coupon_Rate_Accrud));
      put('coupon_type', normCouponType(md.Coupon_Type));
      put('coupon_frequency', normFreq(md.IntrPay_Mode));
      put('interest_payment_dates', s(md.IntrstPay_Date).replace(/,\s*$/, ''));
      put('face_value', num(md.Face_Value));
      put('issue_price', num(md.Issue_Price));
      put('issue_date', normDate(md.Allotment_Date));
      put('listing_date', normDate(md.Listing_Date));
      put('maturity_date', normDate(md.Redemption_Date));
      put('redemption_date', normDate(md.Redemption_Date));
      put('rating', s(md.Rating));
      put('rating_agency', s(md.Rating_Agency));
      put('rating_date', normDate(md.Rating_Date));
      put('seniority', s(md.Seniority));
      put('security_type', s(md.Sec_Type));
      put('secured', /unsec/i.test(s(md.Secure_UnSecure)) ? false : (/sec/i.test(s(md.Secure_UnSecure)) ? true : undefined));
      put('tax_status', s(md.taxation || md.Critria));
      put('exchange_listed', s(md.Listing));
      put('listing_status', s(md.Listing_Status));
      put('nse_symbol', s(md.NSE_Symbol));
      put('bse_code', s(md.BSE_Code));
      put('put_call_type', /n\.?a\.?/i.test(s(md.Put_Call_Type)) ? '' : s(md.Put_Call_Type));
      put('put_call_date', normDate(md.Put_Call_Date));
      put('callable', /call/i.test(s(md.Put_Call_Type)) || undefined);
      put('puttable', /put/i.test(s(md.Put_Call_Type)) || undefined);
      // Sensible market defaults (lower confidence — verifiable/lockable later).
      put('day_count_convention', 'actual_365', 55);
      put('business_day_convention', 'following', 55);
      const docs: Record<string, string> = {};
      for (const [dk, mk] of [['im', 'IM_doc_url'], ['termsheet', 'Termsheet_doc_url'], ['rating', 'RatingRational_doc_url']] as const) {
        const u = s((md as Record<string, unknown>)[mk]); if (u && /^https?:/.test(u)) docs[dk] = u;
      }
      if (Object.keys(docs).length) put('issuer_docs', docs);
      if (s(md.Debenture_Trustee)) put('trustee', s(md.Debenture_Trustee));

      // Contractual principal-repayment structure (redemption dates + pct) — read
      // from the schedule the source publishes. Interest is NOT taken; the
      // analytics engine computes all interest/cashflow internally.
      let redemption: { date: string; pct: number }[] | undefined;
      const fca: unknown[] = Array.isArray(p.finalCashArray) ? p.finalCashArray : [];
      const flat: Record<string, unknown>[] = [];
      for (const grp of fca) { if (Array.isArray(grp)) for (const r of grp) flat.push(r as Record<string, unknown>); }
      const reds = flat.map(r => ({ date: s(r.IP_Date), pct: num(r.Redemption_Amount) ?? 0 }))
        .filter(r => r.pct > 0 && r.date);
      if (reds.length > 1) {
        redemption = reds.map(r => ({ date: parseDateLoose(r.date), pct: r.pct }))
          .filter((r): r is { date: string; pct: number } => !!r.date);
        if (redemption.length) put('principal_repayment_structure', 'amortizing', 70);
      } else {
        put('principal_repayment_structure', 'bullet', 60);
      }

      return { ok: true, fields: f, redemption_schedule: redemption, http };
    } catch (e) {
      return { ok: false, fields: {}, error: e instanceof Error ? e.message : 'fetch error' };
    } finally {
      clearTimeout(timer);
    }
  },
};

const MONTHS: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };
function parseDateLoose(t: string): string | null {
  t = s(t);
  let m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,4})\s+(\d{4})/); // "31 Aug 2026"
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; if (mo === undefined) return null; return `${m[3]}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// The registry the orchestrator iterates. Order/priority independent of code.
// Highest priority first, so the authoritative feed (when enabled) is consulted first.
export const providerRegistry: BondDataProvider[] = [harmoneyProvider, aggregatorProvider];
