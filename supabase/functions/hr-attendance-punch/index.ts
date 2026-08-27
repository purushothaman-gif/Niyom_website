import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveClientIp } from "../_shared/hr/clientIp.ts";

// -----------------------------------------------------------------------------
// Records an attendance punch. This is the ONLY way a punch can be created.
//
// The office-network restriction is worth nothing unless the IP is decided
// here, so:
//
//   * The request body carries { punch_type } and nothing else. An `ip` field,
//     if someone sends one, is never read.
//   * The address comes from X-Forwarded-For via resolveClientIp(), which takes
//     the RIGHT-most entry -- the one the platform appended -- rather than the
//     left-most one a client can prepend. (See _shared/hr/clientIp.ts.)
//   * The write goes through the SECURITY DEFINER RPC hr_record_punch(), which
//     is granted to service_role ONLY. `authenticated` cannot call it, because
//     anything that can call it can name its own IP.
//   * The timestamp is the database's clock. There is no client time anywhere
//     in the path.
//
// The RPC returns refusals as data ({ok:false, code, message}) rather than
// raising, so an ordinary "you are already punched in" is a 200 with a sentence
// a person can act on, not a 500 with a Postgres error in it.
// -----------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    // Identify the caller from their own session, never from the body.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    const db = createClient(supabaseUrl, serviceKey);

    const { data: employee } = await db
      .from("nw_employees")
      .select("id, full_name, status")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!employee || employee.status !== "active") {
      return json({ ok: false, error: "Your employee record is not active. Please contact HR." }, 403);
    }

    let body: {
      punch_type?: string; source?: string;
      latitude?: number; longitude?: number; accuracy?: number; is_mock?: boolean;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Malformed request." }, 400);
    }

    const punchType = body.punch_type === "in" || body.punch_type === "out" ? body.punch_type : null;
    if (!punchType) return json({ ok: false, error: "Specify whether this is a punch in or out." }, 400);

    // How many proxies sit in front of this function is configuration, not a
    // constant: putting a CDN in the path later would shift the trusted entry.
    const { data: settings } = await db
      .from("hr_attendance_settings")
      .select("trusted_proxy_hops")
      .eq("id", 1)
      .maybeSingle();

    const { ip, raw } = resolveClientIp(req.headers, settings?.trusted_proxy_hops ?? 0);

    const source = body.source === "mobile" ? "mobile" : "web";
    const userAgent = req.headers.get("user-agent") ?? "";

    /*
     * Coordinates come from the client because there is nowhere else a GPS fix
     * can come from. They are passed through as REPORTED values and nothing
     * more: the server decides whether the point is inside the geofence, using
     * office coordinates the client is never sent. Anything unparseable or out
     * of range becomes null, which the server treats as "no location" rather
     * than as a position at the equator.
     */
    const coord = (v: unknown, limit: number): number | null => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
    };
    const lat = coord(body.latitude, 90);
    const lon = coord(body.longitude, 180);
    const acc = (() => {
      const n = Number(body.accuracy);
      return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : null;
    })();

    const { data, error } = await db.rpc("hr_record_punch", {
      p_employee_id:   employee.id,
      p_punch_type:    punchType,
      p_detected_ip:   ip,          // null when the header was missing/unusable
      p_forwarded_for: raw,
      p_user_agent:    userAgent,
      p_source:        source,
      /*
       * 0,0 is what an uninitialised coordinate looks like, not a location.
       * The casts are because these parameters have SQL defaults, so the
       * generated types call them optional rather than nullable -- Postgres
       * accepts NULL for all of them, and NULL is what "no fix" must mean.
       */
      p_latitude:      (lat === 0 && lon === 0 ? null : lat) as unknown as number,
      p_longitude:     (lat === 0 && lon === 0 ? null : lon) as unknown as number,
      p_accuracy_m:    acc as unknown as number,
      p_is_mock:       (typeof body.is_mock === "boolean" ? body.is_mock : null) as unknown as boolean,
    });

    if (error) {
      // A raw Postgres message is never useful to an employee standing at the
      // door, and can leak schema detail. Log it, show a sentence.
      console.error("hr_record_punch failed", { employee: employee.id, code: error.code, message: error.message });
      return json({ ok: false, error: "Could not record your attendance just now. Please try again." }, 500);
    }

    const result = data as Record<string, unknown>;
    return json(result, result?.ok === false ? 409 : 200);
  } catch (err) {
    console.error("hr-attendance-punch crashed", err);
    return json({ ok: false, error: "Could not record your attendance just now. Please try again." }, 500);
  }
});
