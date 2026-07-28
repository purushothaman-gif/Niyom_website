// Marketing Tool — referral link click tracking (public).
//
// Called from the public onboarding page when someone arrives via an employee's
// referral link. Public by necessity (the visitor has no session), so it is
// written to be uninteresting to abuse: it stores no personal data, hashes the
// IP before writing, rate-limits per IP, and always answers { ok: true } so it
// never reveals whether a referral code is real.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Cap per IP per hour — enough for real use, not enough to skew a leaderboard. */
const MAX_CLICKS_PER_IP_PER_HOUR = 30;

/** Salted so the stored value cannot be reversed to an address by lookup. */
async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* nothing to record */ }

    const ref = String(body.ref ?? "").trim().slice(0, 64);
    if (!ref) return json({ ok: true });

    const contentNo = body.cnt ? String(body.cnt).trim().slice(0, 32) : null;
    const platform = body.pl ? String(body.pl).trim().slice(0, 32) : "";

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const forwarded = req.headers.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0].trim() || "unknown";
    const ipHash = await hashIp(ip);

    // Throttle before writing anything.
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await db
      .from("mkt_referral_clicks")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", oneHourAgo);

    if ((count ?? 0) >= MAX_CLICKS_PER_IP_PER_HOUR) return json({ ok: true, throttled: true });

    // Resolve the code to an employee. An unknown or retired code still records
    // the click (useful for spotting stale links in the wild) but attributes it
    // to nobody.
    const { data: link } = await db
      .from("mkt_referral_links")
      .select("employee_id")
      .eq("ref_code", ref)
      .eq("active", true)
      .maybeSingle();

    await db.from("mkt_referral_clicks").insert([{
      ref_code: ref,
      employee_id: link?.employee_id ?? null,
      content_no: contentNo,
      platform,
      ip_hash: ipHash,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    }]);

    return json({ ok: true });
  } catch (err) {
    // Never let tracking break the onboarding page it is called from.
    console.error("mkt-track-click failed:", err);
    return json({ ok: true });
  }
});
