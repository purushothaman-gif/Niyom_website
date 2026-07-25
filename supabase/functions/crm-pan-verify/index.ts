import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, isValidPan } from "../_shared/onboarding.ts";
import { getPanGateway } from "../_shared/panGateway.ts";

// Employee-facing PAN verification for the CRM onboarding form. An RM enters a
// PAN and gets the name-as-per-PAN back to auto-fill the form. Unlike the
// client-facing public-pan-verify, this does NOT touch nw_clients (the client
// row usually doesn't exist yet) and requires the caller to be an active
// EMPLOYEE. Reuses the exact same droplet relay -> Cashfree path via getPanGateway.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Caller must be an active employee.
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: emp } = await admin
      .from("nw_employees")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!emp) return json({ error: "Not an active employee." }, 403);

    const body = await req.json().catch(() => ({}));
    const pan = (body.pan || "").trim().toUpperCase();
    if (!isValidPan(pan)) return json({ error: "Enter a valid PAN (e.g. ABCDE1234F)." }, 400);

    const result = await getPanGateway().verify(pan);
    if (!result.valid) {
      return json({ valid: false, error: result.message || "PAN could not be verified." }, 422);
    }
    return json({ valid: true, name_as_per_pan: result.name_as_per_pan }, 200);
  } catch (err: any) {
    console.error("crm-pan-verify error:", err?.message);
    return json({ error: err?.message || "PAN verification failed. Please try again." }, 500);
  }
});
