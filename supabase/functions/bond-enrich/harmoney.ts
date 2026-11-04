// Adapter: Harmoney / InferEdge India fixed-income API (licensed).
//   Docs: https://docs.inferedge.com/reference/overview
//
// Why this source: it serves each ISIN's FULL cash-flow schedule with a RECORD DATE on every
// payment — the two facts the SMC sheet does not carry and that accrued interest depends on —
// plus a price/accrued calculator we use as an independent check of our own figure.
//
// DORMANT until the secret HARMONEY_API_KEY is set (`supabase secrets set HARMONEY_API_KEY=…`).
// Optional HARMONEY_API_BASE overrides the host (e.g. https://api.harmoney.dev for their dev env).
//
// Response shapes follow the published OpenAPI reference. Two things it leaves unstated are
// handled defensively and should be confirmed on the first live call:
//   • `coupon` may be a percent ("9.5") or a decimal ("0.095") → < 1 is treated as decimal.
//   • `coupon_frequency` may be text ("Monthly") or a count (12) → both are mapped.

import type { BondDataProvider, Field, ProviderResult } from './providers.ts';
import type { ProviderFlow } from './analytics.ts';

const TIMEOUT_MS = 15000;

function env(name: string): string | undefined {
  try { return (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(name); }
  catch { return undefined; }
}
const apiKey = () => env('HARMONEY_API_KEY')?.trim() || '';
const apiBase = () => (env('HARMONEY_API_BASE')?.trim() || 'https://api.harmoney.in').replace(/\/+$/, '');
// Set when the API rejects the key (401/403). Stops every further call in this invocation —
// a bad or expired key must not turn the 10-minute sweep into a stream of failed requests.
let authRejected = false;
export const harmoneyAuthRejected = () => authRejected;
export const harmoneyEnabled = () => apiKey().length > 0 && !authRejected;

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { 'x-api-key': apiKey(), 'Accept': 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) authRejected = true;
    const text = await res.text();
    let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, json, error: res.ok ? undefined : `HTTP ${res.status} ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: e instanceof Error ? e.message : 'fetch error' };
  } finally {
    clearTimeout(timer);
  }
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {});
const str = (v: unknown): string => String(v ?? '').trim();
function num(v: unknown): number | null { const n = parseFloat(str(v).replace(/[, ]/g, '')); return Number.isFinite(n) ? n : null; }
function isoDate(v: unknown): string | null { const t = str(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; }

export function mapFrequency(v: unknown): string {
  const n = num(v);
  if (n !== null && /^\d+(\.0+)?$/.test(str(v))) return n === 12 ? 'monthly' : n === 4 ? 'quarterly' : n === 2 ? 'half_yearly' : n === 1 ? 'annual' : n === 0 ? 'zero' : '';
  const t = str(v).toLowerCase();
  if (t.includes('month')) return 'monthly';
  if (t.includes('quart')) return 'quarterly';
  if (t.includes('half') || t.includes('semi')) return 'half_yearly';
  if (t.includes('annual') || t.includes('year')) return 'annual';
  if (t.includes('zero') || t.includes('maturity') || t.includes('cumulative')) return 'zero';
  return '';
}
export function mapDayCount(v: unknown): string {
  const t = str(v).toLowerCase().replace(/\s+/g, '');
  if (!t) return '';
  if (t.includes('30')) return '30_360';
  if (/act(ual)?\/act(ual)?/.test(t)) return 'actual_actual';
  if (t.includes('365')) return 'actual_365';
  return '';
}
export function mapCoupon(v: unknown): number | null {
  const n = num(v); if (n === null) return null;
  return n > 0 && n < 1 ? +(n * 100).toFixed(6) : n;
}
export function mapFlowType(v: unknown): ProviderFlow['type'] {
  const t = str(v).toLowerCase();
  if (/coupon|interest/.test(t)) return 'coupon';
  if (/principal|redemption|maturity|call|put|repay/.test(t)) return 'principal';
  return 'other';
}

/** CashflowItem[] (requested with quantum = 100) → per-₹100 flows. */
export function mapCashflows(items: unknown): ProviderFlow[] {
  if (!Array.isArray(items)) return [];
  const out: ProviderFlow[] = [];
  for (const raw of items) {
    const r = o(raw);
    const date = isoDate(r.transaction_date); const amt = num(r.cashflow);
    if (!date || amt === null) continue;
    out.push({ date, record_date: isoDate(r.record_date), type: mapFlowType(r.transaction_type), amount_per_100: amt, interest_days: num(r.interest_days) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** DebtInstrumentResponse → normalized bm_bonds fields. */
export function mapInstrument(j: unknown): Record<string, Field> {
  const r = o(j); const iss = o(r.issuance_details); const cpn = o(r.coupon_details); const mat = o(r.maturity_details); const cov = o(r.covenants);
  const f: Record<string, Field> = {};
  const put = (k: string, v: unknown, c = 95) => { if (v !== null && v !== undefined && v !== '') f[k] = { value: v, confidence: c }; };
  put('coupon_rate', mapCoupon(cpn.coupon));
  put('coupon_frequency', mapFrequency(cpn.coupon_frequency));
  put('day_count_convention', mapDayCount(cpn.day_count_convention));
  const ct = str(cpn.coupon_type).toLowerCase();
  put('coupon_type', ct.includes('float') ? 'floating' : ct.includes('zero') ? 'zero' : ct ? 'fixed' : '');
  put('issue_date', isoDate(iss.issue_date));
  put('maturity_date', isoDate(mat.maturity_date));
  put('face_value', num(iss.face_value));
  if (typeof cov.secured === 'boolean') put('secured', cov.secured);
  if (str(cov.seniority)) put('seniority', str(cov.seniority).toLowerCase(), 80);
  if (typeof iss.is_listed === 'boolean') put('exchange_listed', iss.is_listed, 90);
  // issuer_name lives on the entity endpoint; not fetched (the sheet/scraper supply it).
  return f;
}

export const harmoneyProvider: BondDataProvider = {
  id: 'harmoney-inferedge',
  label: 'Harmoney / InferEdge (licensed)',
  tier: 'licensed',
  priority: 100,                                  // above the SMC sheet (95) and the public scraper (40)
  get enabled() { return harmoneyEnabled(); },
  async fetchByISIN(isin: string): Promise<ProviderResult> {
    const ins = await call('GET', `/api/instrument/isin/${encodeURIComponent(isin)}`);
    if (!ins.ok) return { ok: false, fields: {}, error: ins.error, http: ins.status };
    const instrumentId = num(o(ins.json).instrument_id);
    const fields = mapInstrument(ins.json);
    let cashflows: ProviderFlow[] | undefined;
    let cfError: string | undefined;
    if (instrumentId !== null) {
      // quantum = 100 → every amount is already per ₹100 of face; schedule to final maturity.
      const cf = await call('POST', `/api/instrument/${instrumentId}/cashflows`, { quantum: 100, termination_type: 'maturity' });
      if (cf.ok) cashflows = mapCashflows(cf.json); else cfError = cf.error;
    }
    const redemption = (cashflows ?? []).filter((c) => c.type === 'principal').map((c) => ({ date: c.date, pct: c.amount_per_100 }));
    if (redemption.length) fields.principal_repayment_structure = { value: redemption.length > 1 ? 'amortizing' : 'bullet', confidence: 95 };
    return {
      ok: true, fields, http: ins.status,
      redemption_schedule: redemption.length > 1 ? redemption : undefined,
      cashflows: cashflows && cashflows.length ? cashflows : undefined,
      source_ref: instrumentId !== null ? { instrument_id: instrumentId } : undefined,
      error: cfError,
    };
  },
};

export type ProviderAccruedCheck = {
  provider: string; settlement_date: string;
  provider_accrued_per_100: number | null; provider_accrued_days: number | null;
  provider_previous_coupon_date: string | null; provider_yield_pct: number | null;
  error?: string;
};

/** The provider's own accrued for a settlement date — an independent check on ours. */
export async function harmoneyAccruedCheck(instrumentId: number, settlementISO: string, cleanPer100: number): Promise<ProviderAccruedCheck> {
  const base: ProviderAccruedCheck = { provider: harmoneyProvider.id, settlement_date: settlementISO, provider_accrued_per_100: null, provider_accrued_days: null, provider_previous_coupon_date: null, provider_yield_pct: null };
  const r = await call('POST', `/api/instrument/${instrumentId}/calculate`, { as_of_date: settlementISO, price: cleanPer100, quantum: 100, termination_type: 'maturity' });
  if (!r.ok) return { ...base, error: r.error };
  const j = o(r.json);
  const y = num(j.yield);
  return {
    ...base,
    provider_accrued_per_100: num(j.unit_accrued_interest) ?? num(j.accrued_interest),
    provider_accrued_days: num(j.accrued_interest_days),
    provider_previous_coupon_date: isoDate(j.previous_coupon_date),
    provider_yield_pct: y === null ? null : (y < 1 ? +(y * 100).toFixed(4) : y),
  };
}
