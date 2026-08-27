import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveClientIp } from "../_shared/hr/clientIp.ts";

// -----------------------------------------------------------------------------
// Today's attendance state for the signed-in employee, including the SERVER's
// verdict on where they are standing.
//
// It exists so the punch card can say "you are within the office attendance
// area" -- or how far outside it they are -- BEFORE the button is pressed,
// without the browser ever being told where the office is or how wide the
// geofence is. An employee who could read those two numbers would know exactly
// what to feed a spoofed location, so the client is sent a verdict and a
// rounded distance and nothing else.
//
// Read-only. It performs the SAME checks as the punch endpoint, from the same
// inputs, so the preview can never disagree with the actual decision.
// -----------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);

    const db = createClient(supabaseUrl, serviceKey);

    const { data: employee } = await db
      .from("nw_employees")
      .select("id, status")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!employee || employee.status !== "active") {
      return json({ ok: false, error: "Your employee record is not active." }, 403);
    }

    const { data: settings } = await db
      .from("hr_attendance_settings")
      .select("trusted_proxy_hops")
      .eq("id", 1)
      .maybeSingle();

    const { ip, raw } = resolveClientIp(req.headers, settings?.trusted_proxy_hops ?? 0);

    /*
     * The browser's reported fix, sanitised exactly as the punch endpoint
     * sanitises it. Same rules in both places on purpose: if this endpoint were
     * more lenient the card would promise a punch the punch endpoint then
     * refused, which is the most annoying possible failure -- it looks like the
     * button is broken. Out-of-range values, and the uninitialised 0,0, become
     * null, which the server reads as "no fix" rather than as the Atlantic.
     */
    let body: { latitude?: number; longitude?: number; accuracy?: number } = {};
    try { body = await req.json(); } catch { /* GET, or an empty body: no fix */ }

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
    const empty = lat === null || lon === null || (lat === 0 && lon === 0);

    const { data, error } = await db.rpc("hr_punch_state", {
      p_employee_id: employee.id,
      p_detected_ip: ip,
      // Casts because these parameters carry SQL defaults, so the generated
      // types call them optional rather than nullable. Postgres accepts NULL.
      p_forwarded_for: raw as unknown as string,
      p_latitude:      (empty ? null : lat) as unknown as number,
      p_longitude:     (empty ? null : lon) as unknown as number,
      p_accuracy_m:    (empty ? null : acc) as unknown as number,
    });

    if (error) {
      console.error("hr_punch_state failed", { employee: employee.id, message: error.message });
      return json({ ok: false, error: "Could not load your attendance just now." }, 500);
    }

    return json({ ok: true, ...(data as Record<string, unknown>) });
  } catch (err) {
    console.error("hr-attendance-state crashed", err);
    return json({ ok: false, error: "Could not load your attendance just now." }, 500);
  }
});
