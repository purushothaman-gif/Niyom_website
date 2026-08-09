import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Generic error to avoid leaking whether a PAN exists
const INVALID = { error: "Invalid PAN or password." };

// This endpoint resolves a PAN to the registered email so the browser can call
// signInWithPassword. That makes it a PAN -> email oracle for anyone who can
// guess a PAN (semi-public in India), so it is throttled per source IP exactly
// like partner-pan-login. Same limits, same salted-hash construction.
const MAX_FAILURES_PER_IP = 10;
const WINDOW_MS = 15 * 60 * 1000;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Same construction as partner-pan-login / mkt-track-click: salted SHA-256, truncated. */
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
      .from("nw_client_login_audit")
      .select("id", { count: "exact", head: true })
      .eq("action", "login_failed")
      .eq("metadata->>ip_hash", ipHash)
      .gte("created_at", since);

    if ((count ?? 0) >= MAX_FAILURES_PER_IP) {
      return json({ error: "Too many attempts. Please try again later." }, 429);
    }

    const recordFailure = async (reason: string) => {
      await db.from("nw_client_login_audit").insert({
        client_id: null,
        action: "login_failed",
        metadata: { ip_hash: ipHash, reason },
      });
    };

    if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      await recordFailure("bad_pan_format");
      return json(INVALID, 401);
    }

    // Look up the client by PAN using the service role (bypasses RLS safely).
    // limit(2) so a duplicate PAN is detected rather than silently resolving to
    // an arbitrary row.
    const { data: rows } = await db
      .from("nw_clients")
      .select("id, email, client_password_changed")
      .eq("pan", pan)
      .eq("client_login_enabled", true)
      .limit(2);

    if (!rows || rows.length !== 1 || !rows[0].email) {
      await recordFailure(rows && rows.length > 1 ? "ambiguous_pan" : "no_match");
      return json(INVALID, 401);
    }

    const client = rows[0];

    // The password itself is verified by GoTrue on the next call; this only
    // records the successful PAN *resolution*.
    await db.from("nw_client_login_audit").insert({
      client_id: client.id,
      action: "pan_resolved",
      metadata: { ip_hash: ipHash },
    });

    // Return only what the frontend needs to proceed with signInWithPassword
    return json({
      client_id: client.id,
      client_email: client.email,
      password_changed: client.client_password_changed,
    }, 200);
  } catch (err: any) {
    console.error("client-pan-login error:", err?.message);
    return json(INVALID, 500);
  }
});
