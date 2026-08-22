import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveClientIp } from "../_shared/hr/clientIp.ts";

// -----------------------------------------------------------------------------
// Today's attendance state for the signed-in employee, including the SERVER's
// verdict on the network they are currently on.
//
// It exists so the punch card can say "Niyom Chennai Office" (or warn that they
// are outside it) BEFORE the button is pressed, without the browser ever being
// told what the office IPs are -- hr_allowed_networks is HR-readable only, and
// an employee who could enumerate it would know exactly what to spoof.
//
// Read-only, and it applies the same right-most X-Forwarded-For rule as the
// punch endpoint so the preview cannot disagree with the actual decision.
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

    const { ip } = resolveClientIp(req.headers, settings?.trusted_proxy_hops ?? 0);

    const { data, error } = await db.rpc("hr_punch_state", {
      p_employee_id: employee.id,
      p_detected_ip: ip,
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
