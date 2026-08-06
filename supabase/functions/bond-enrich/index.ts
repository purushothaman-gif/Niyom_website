import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { providerRegistry, Field } from "./providers.ts";
import { computeAnalytics, Frequency, DayCount, BizConv } from "./analytics.ts";

// Enrichment orchestrator. For each target bond: query every enabled provider via
// the registry (never naming one), merge fields by priority×confidence while
// respecting locked fields, compute all analytics internally, persist master +
// schedules + provenance, score data quality, and queue anything insufficient.
// Writes with the service role (RLS bypassed); callers are authenticated staff.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Fields that must exist for a bond to count as "verified".
const REQUIRED = ["coupon_rate", "coupon_frequency", "maturity_date", "face_value"];
// Weighted set for the data-quality score.
const QUALITY_FIELDS = [
  "issuer_name", "coupon_rate", "coupon_type", "coupon_frequency", "interest_payment_dates",
  "maturity_date", "issue_date", "face_value", "rating", "rating_agency", "seniority",
  "security_type", "secured", "tax_status", "exchange_listed", "principal_repayment_structure",
];

type Client = ReturnType<typeof createClient>;

async function enrichOne(supabase: Client, bond: Record<string, unknown>, holidays: Set<string>, skipProviders = false) {
  const isin = String(bond.isin);
  const bondId = String(bond.id);
  if (!skipProviders) await supabase.from("bm_bonds").update({ verification_status: "enriching" }).eq("id", bondId);

  // Locked fields must never be overwritten.
  const { data: prov } = await supabase.from("bm_field_provenance").select("field_name,is_locked").eq("bond_id", bondId);
  const locked = new Set((prov ?? []).filter((p: Record<string, unknown>) => p.is_locked).map((p: Record<string, unknown>) => String(p.field_name)));

  // Query every enabled provider; merge by priority×confidence. Skipped in remaster
  // mode, where we re-merge the sheet over the already-stored master (no fetches).
  const merged: Record<string, { value: unknown; source: string; confidence: number; score: number }> = {};
  let redemption: { date: string; pct: number }[] | undefined;
  if (!skipProviders) for (const provider of providerRegistry.filter((p) => p.enabled)) {
    const t0 = Date.now();
    let r; try { r = await provider.fetchByISIN(isin); } catch (e) { r = { ok: false, fields: {} as Record<string, Field>, error: String(e) }; }
    await supabase.from("bm_provider_log").insert({
      isin, bond_id: bondId, provider_id: provider.id, status: r.ok ? "ok" : "error",
      http_status: r.http ?? null, latency_ms: Date.now() - t0,
      fields_returned: r.ok ? Object.keys(r.fields).length : 0, error: r.error ?? "",
    });
    if (!r.ok) continue;
    for (const [field, fv] of Object.entries(r.fields as Record<string, Field>)) {
      if (locked.has(field)) continue;
      const score = provider.priority * (fv.confidence ?? 0);
      if (!merged[field] || score > merged[field].score) merged[field] = { value: fv.value, source: provider.id, confidence: fv.confidence ?? 0, score };
    }
    if (r.redemption_schedule && r.redemption_schedule.length && !redemption && !locked.has("redemption_schedule")) redemption = r.redemption_schedule;
  }

  // The uploaded SMC dealer sheet is the PRIMARY source: its per-bond fields win
  // over the public scraper (which is stale/incomplete). The scraper only gap-fills
  // fields the sheet doesn't carry (e.g. a missing maturity). Sheet values are
  // stored at import time in import_raw.
  const raw = (bond.import_raw ?? {}) as Record<string, unknown>;
  const SHEET_FIELDS = ["coupon_rate", "coupon_type", "coupon_frequency", "interest_payment_dates",
    "maturity_date", "face_value", "min_investment", "rating", "rating_agency", "seniority", "security_type",
    "tax_status", "principal_repayment_structure"];
  for (const field of SHEET_FIELDS) {
    if (locked.has(field)) continue;
    const v = raw[field];
    if (v === null || v === undefined || v === "") continue;
    const score = 95 * 90;                                    // priority 95 × confidence 90 — above the scraper (40×85)
    if (!merged[field] || score > merged[field].score) merged[field] = { value: v, source: "excel", confidence: 90, score };
  }
  // Redemption schedule: prefer the sheet's when it carries one; else keep the scraper's.
  if (Array.isArray(raw.redemption_schedule) && (raw.redemption_schedule as unknown[]).length && !locked.has("redemption_schedule")) {
    redemption = raw.redemption_schedule as { date: string; pct: number }[];
  }

  // Resolve effective master values (merged, else existing).
  const val = (k: string): unknown => (merged[k] ? merged[k].value : bond[k]);

  // Issuer upsert.
  let issuerId = bond.issuer_id as string | null;
  const issuerName = String(val("issuer_name") ?? "").trim();
  if (issuerName) {
    const { data: existing } = await supabase.from("bm_issuers").select("id").ilike("name", issuerName).maybeSingle();
    if (existing) issuerId = String(existing.id);
    else { const { data: ins } = await supabase.from("bm_issuers").insert({ name: issuerName }).select("id").single(); if (ins) issuerId = String(ins.id); }
  }

  // Compute analytics internally.
  const a = computeAnalytics({
    couponRate: numOrNull(val("coupon_rate")),
    frequency: (String(val("coupon_frequency") ?? "") as Frequency),
    maturityISO: (val("maturity_date") as string) ?? null,
    issueDateISO: (val("issue_date") as string) ?? null,
    ipDatesSeed: String(val("interest_payment_dates") ?? ""),
    redemptionSchedule: redemption,
    dayCount: (String(val("day_count_convention") ?? "actual_365") as DayCount),
    bizConv: (String(val("business_day_convention") ?? "following") as BizConv),
    holidays,
    cleanPricePer100: numOrNull(bond.latest_price),
  });

  // Persist schedules (replace).
  await supabase.from("bm_coupon_schedule").delete().eq("bond_id", bondId);
  await supabase.from("bm_cashflow_schedule").delete().eq("bond_id", bondId);
  if (a.ok) {
    if (a.coupon_schedule.length) await supabase.from("bm_coupon_schedule").insert(a.coupon_schedule.map((c) => ({ bond_id: bondId, ...c })));
    if (a.cashflow_schedule.length) await supabase.from("bm_cashflow_schedule").insert(a.cashflow_schedule.map((c) => ({ bond_id: bondId, ...c })));
  }

  // Data-quality + verification status.
  const present = QUALITY_FIELDS.filter((k) => val(k) !== null && val(k) !== undefined && String(val(k)).trim() !== "");
  const quality = Math.round((present.length / QUALITY_FIELDS.length) * 100);
  const missingRequired = REQUIRED.filter((k) => val(k) === null || val(k) === undefined || String(val(k)).trim() === "");
  const status = missingRequired.length === 0 ? "verified" : "needs_review";

  const nextCoupon = a.ok && a.coupon_schedule[0] ? a.coupon_schedule[0].pay_date : null;

  // Build the master update from merged fields (never locked ones).
  const upd: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) if (!["issuer_name"].includes(k)) upd[k] = v.value;
  Object.assign(upd, {
    issuer_id: issuerId,
    redemption_schedule: redemption ?? bond.redemption_schedule ?? [],
    analytics: analyticsJson(a),
    analytics_computed_at: new Date().toISOString(),
    next_coupon_date: nextCoupon,
    data_quality_score: quality,
    verification_status: status,
    perpetual: /perp/i.test(String(val("bond_name") ?? "")) || undefined,
    enriched_at: new Date().toISOString(),
    source_summary: Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, { source: v.source, confidence: v.confidence }])),
  });
  await supabase.from("bm_bonds").update(clean(upd)).eq("id", bondId);

  // Provenance (skip locked).
  const provRows = Object.entries(merged)
    .filter(([k]) => !locked.has(k))
    .map(([k, v]) => ({ bond_id: bondId, field_name: k, value: String(v.value ?? ""), source: v.source, confidence: v.confidence, updated_at: new Date().toISOString() }));
  if (provRows.length) await supabase.from("bm_field_provenance").upsert(provRows, { onConflict: "bond_id,field_name" });

  // Verification queue.
  if (status === "needs_review") {
    await supabase.from("bm_verification_queue").upsert({
      bond_id: bondId, missing_fields: missingRequired, confidence: quality, status: "open",
      reason: `Missing required: ${missingRequired.join(", ")}`,
    }, { onConflict: "bond_id" });
  } else {
    await supabase.from("bm_verification_queue").delete().eq("bond_id", bondId).eq("status", "open");
  }

  return { isin, status, quality, ytm: a.ytm, cashflows: a.cashflow_schedule.length };
}

// Fast recompute: recompute analytics + schedules from the bond's ALREADY-STORED
// master + current latest_price, with NO provider calls. Used to refresh yields
// after a daily price change and to backfill after an engine fix. Never touches
// master fields, provenance, quality or verification status.
async function recomputeOne(supabase: Client, bond: Record<string, unknown>, holidays: Set<string>) {
  const bondId = String(bond.id);
  const redemption = Array.isArray(bond.redemption_schedule) && (bond.redemption_schedule as unknown[]).length
    ? (bond.redemption_schedule as { date: string; pct: number }[]) : undefined;
  const a = computeAnalytics({
    couponRate: numOrNull(bond.coupon_rate),
    frequency: (String(bond.coupon_frequency ?? "") as Frequency),
    maturityISO: (bond.maturity_date as string) ?? null,
    issueDateISO: (bond.issue_date as string) ?? null,
    ipDatesSeed: String(bond.interest_payment_dates ?? ""),
    redemptionSchedule: redemption,
    dayCount: (String(bond.day_count_convention ?? "actual_365") as DayCount),
    bizConv: (String(bond.business_day_convention ?? "following") as BizConv),
    holidays,
    cleanPricePer100: numOrNull(bond.latest_price),
  });
  await supabase.from("bm_coupon_schedule").delete().eq("bond_id", bondId);
  await supabase.from("bm_cashflow_schedule").delete().eq("bond_id", bondId);
  if (a.ok) {
    if (a.coupon_schedule.length) await supabase.from("bm_coupon_schedule").insert(a.coupon_schedule.map((c) => ({ bond_id: bondId, ...c })));
    if (a.cashflow_schedule.length) await supabase.from("bm_cashflow_schedule").insert(a.cashflow_schedule.map((c) => ({ bond_id: bondId, ...c })));
  }
  const nextCoupon = a.ok && a.coupon_schedule[0] ? a.coupon_schedule[0].pay_date : null;
  await supabase.from("bm_bonds").update({
    analytics: analyticsJson(a),
    analytics_computed_at: new Date().toISOString(),
    next_coupon_date: nextCoupon,
  }).eq("id", bondId);
  return { isin: String(bond.isin), status: "recomputed", ytm: a.ytm, cashflows: a.cashflow_schedule.length };
}

function analyticsJson(a: ReturnType<typeof computeAnalytics>) {
  return {
    accrued_per_100: a.accrued_per_100, clean_price: a.clean_price, dirty_price: a.dirty_price,
    current_yield: a.current_yield, ytm: a.ytm, macaulay_duration: a.macaulay_duration,
    modified_duration: a.modified_duration, days_to_maturity: a.days_to_maturity,
    years_to_maturity: a.years_to_maturity, total_future_interest_per_100: a.total_future_interest_per_100,
    total_future_principal_per_100: a.total_future_principal_per_100, assumed_bullet: a.assumed_bullet,
    settlement_date: a.settlement_date, ok: a.ok, reason: a.reason ?? null,
  };
}

function numOrNull(v: unknown): number | null { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : null; }
function clean(o: Record<string, unknown>): Record<string, unknown> { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v; return out; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, serviceKey);

    // Authorize the caller. Two accepted callers:
    //  • the scheduled job / backend — presents the service-role key as bearer (pg_cron
    //    via pg_net); trusted, skips the staff check.
    //  • the CRM app — presents a logged-in staff user's JWT, verified against nw_employees.
    const authHeader = req.headers.get("Authorization") ?? "";
    const isCron = authHeader === `Bearer ${serviceKey}`;
    if (!isCron) {
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      const { data: emp } = await supabase.from("nw_employees").select("id").eq("auth_user_id", user.id).eq("status", "active").maybeSingle();
      if (!emp) return new Response(JSON.stringify({ error: "Staff only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 25, 100);
    const recompute = body.recompute === true;   // recompute analytics only, no provider calls
    const remaster = body.remaster === true;      // re-merge the sheet over the stored master, then recompute (no provider calls)
    const stale = body.stale === true;            // only bonds whose price is newer than their analytics

    const { data: hol } = await supabase.from("bm_holiday_calendar").select("holiday_date");
    const holidays = new Set<string>((hol ?? []).map((h: Record<string, unknown>) => String(h.holiday_date)));

    // Stale-recompute sweep (used by the cron safety-net): recompute every active bond whose
    // price changed after its analytics were last computed, looping in bounded batches until
    // none remain. No provider calls, so it's cheap even across the whole book.
    if (recompute && stale && !(Array.isArray(body.bond_ids) && body.bond_ids.length) && !body.isin) {
      const batch = Math.min(Number(body.limit) || 100, 200);
      const results = [];
      const seen = new Set<string>();   // guarantees forward progress even if a bond keeps failing
      for (let iter = 0; iter < 200; iter++) {
        // Column-to-column staleness (price newer than analytics) lives in a SQL function,
        // since PostgREST filters can only compare a column to a literal.
        const { data: bonds, error } = await supabase.rpc("bm_stale_bonds", { p_limit: batch });
        if (error) throw error;
        const fresh = ((bonds as Record<string, unknown>[]) ?? []).filter((b) => !seen.has(String(b.id)));
        if (fresh.length === 0) break;   // nothing left, or only rows that already failed this sweep
        for (const rec of fresh) {
          seen.add(String(rec.id));
          try { results.push(await recomputeOne(supabase, rec, holidays)); }
          catch (e) { results.push({ isin: String(rec.isin), status: "failed", error: String(e) }); }
        }
      }
      return new Response(JSON.stringify({ recomputed: results.length, results }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    let query = supabase.from("bm_bonds").select("*");
    if (Array.isArray(body.bond_ids) && body.bond_ids.length) query = query.in("id", body.bond_ids);
    else if (body.isin) query = query.eq("isin", String(body.isin).toUpperCase());
    else if (recompute || remaster) query = query.eq("active_status", "active").limit(limit);
    else query = query.eq("verification_status", "pending").limit(limit);
    const { data: bonds, error } = await query;
    if (error) throw error;

    const results = [];
    for (const b of (bonds ?? [])) {
      const rec = b as Record<string, unknown>;
      try {
        if (recompute) results.push(await recomputeOne(supabase, rec, holidays));
        else results.push(await enrichOne(supabase, rec, holidays, remaster));   // remaster ⇒ skip provider fetches
      } catch (e) {
        results.push({ isin: String(rec.isin), status: "failed", error: String(e) });
        if (!recompute && !remaster) await supabase.from("bm_bonds").update({ verification_status: "failed" }).eq("id", rec.id);
      }
    }
    return new Response(JSON.stringify({ enriched: results.length, recomputed: recompute ? results.length : undefined, results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
