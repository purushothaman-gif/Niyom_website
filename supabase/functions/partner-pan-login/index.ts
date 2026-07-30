/**
 * partner-pan-login — resolve a partner's (DSA's) PAN to the email their
 * Supabase auth user is registered under, so the browser can then call
 * partnerSupabase.auth.signInWithPassword().
 *
 * Modelled on client-pan-login, with two deliberate hardenings:
 *
 *   1. Server-side per-IP throttle. The sessionStorage limiter in the login
 *      screen is client-side only and trivially bypassed with curl. This is an
 *      unauthenticated PAN-probing surface, so the throttle lives here.
 *      (client-pan-login has the same gap — worth a follow-up.)
 *
 *   2. nw_dsa.pan has no unique index and its casing is not normalised, so the
 *      lookup is case-insensitive and explicitly rejects an ambiguous match
 *      rather than using .maybeSingle(), which throws on duplicates.
 *
 * Every failure path returns the same generic 401 so the endpoint cannot be
 * used to discover which PANs belong to a partner.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const INVALID = { error: "Invalid PAN or password." };
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Throttle: failed partner-login lookups allowed per IP per window.
const MAX_FAILURES_PER_IP = 10;
const WINDOW_MS = 15 * 60 * 1000;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Same construction as mkt-track-click: salted SHA-256, truncated. */
async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const pan: string = String(body.pan ?? "").trim().toUpperCase();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const forwarded = req.headers.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0].trim() || "unknown";
    const ipHash = await hashIp(ip);

    // Throttle before doing any lookup work.
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await db
      .from("nw_dsa_login_audit")
      .select("id", { count: "exact", head: true })
      .eq("action", "login_failed")
      .eq("metadata->>ip_hash", ipHash)
      .gte("created_at", since);

    if ((count ?? 0) >= MAX_FAILURES_PER_IP) {
      return json({ error: "Too many attempts. Please try again later." }, 429);
    }

    const recordFailure = async (reason: string, dsaId: string | null = null) => {
      await db.from("nw_dsa_login_audit").insert({
        dsa_id: dsaId,
        action: "login_failed",
        actor: "system",
        metadata: { ip_hash: ipHash, reason },
      });
    };

    if (!pan || !PAN_RE.test(pan)) {
      await recordFailure("bad_pan_format");
      return json(INVALID, 401);
    }

    // Case-insensitive equality (.ilike with no wildcards). limit(2) so an
    // ambiguous PAN is detected rather than silently resolving to a random row.
    const { data: rows } = await db
      .from("nw_dsa")
      .select("id, email, dsa_code, full_name, dsa_password_changed")
      .ilike("pan", pan)
      .eq("dsa_login_enabled", true)
      .eq("status", "active")
      .limit(2);

    if (!rows || rows.length !== 1 || !rows[0].email) {
      await recordFailure(rows && rows.length > 1 ? "ambiguous_pan" : "no_match");
      return json(INVALID, 401);
    }

    const dsa = rows[0];

    // The password itself is verified by GoTrue on the next call. Record the
    // successful *resolution* and stamp last-seen; a wrong password simply
    // never reaches this function again.
    await db.from("nw_dsa_login_audit").insert({
      dsa_id: dsa.id,
      action: "login_success",
      actor: "dsa",
      metadata: { ip_hash: ipHash },
    });
    await db.from("nw_dsa").update({ dsa_last_login_at: new Date().toISOString() })
      .eq("id", dsa.id);

    return json({
      dsa_id: dsa.id,
      dsa_email: dsa.email,
      dsa_code: dsa.dsa_code,
      full_name: dsa.full_name,
      password_changed: dsa.dsa_password_changed,
    }, 200);
  } catch (err) {
    console.error("partner-pan-login error:", (err as Error)?.message);
    return json(INVALID, 500);
  }
});
