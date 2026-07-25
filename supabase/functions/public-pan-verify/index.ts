import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient, isValidPan } from "../_shared/onboarding.ts";
import { getPanGateway } from "../_shared/panGateway.ts";

// Step 2 — verify a client's PAN and fetch the name as per PAN (Cashfree behind
// a PanGateway). Requires the CLIENT's Supabase session (Bearer) and confirms
// the session owns the client_id, so PAN lookups can't be run anonymously.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identify the caller from their access token.
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user || user.user_metadata?.is_client !== true) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const client_id = (body.client_id || "").trim();
    const pan = (body.pan || "").trim().toUpperCase();
    if (!client_id) return json({ error: "Missing client." }, 400);
    if (!isValidPan(pan)) return json({ error: "Enter a valid PAN (e.g. ABCDE1234F)." }, 400);

    const db = serviceClient();

    // The session must own this client record.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) {
      return json({ error: "Unauthorized" }, 403);
    }

    // Reject a PAN already registered to a different client.
    const { data: dupe } = await db
      .from("nw_clients")
      .select("id")
      .eq("pan", pan)
      .neq("id", client_id)
      .maybeSingle();
    if (dupe) {
      return json({ error: "This PAN is already registered. Please contact support." }, 409);
    }

    // Verify via the gateway (Cashfree in prod, mock when unconfigured).
    const gateway = getPanGateway();
    const result = await gateway.verify(pan, client.full_name);
    if (!result.valid) {
      return json({ error: result.message || "PAN could not be verified. Please check and retry." }, 422);
    }

    const nameAsPerPan = result.name_as_per_pan || client.full_name;

    await db.from("nw_clients").update({
      pan,
      pan_name: nameAsPerPan,
      pan_verified: true,
    }).eq("id", client_id);

    await db.from("nw_activity_logs").insert([{
      client_id,
      action: "PAN Verified",
      description: `PAN verified for client. Name as per PAN: ${nameAsPerPan}.`,
    }]);

    return json({ success: true, valid: true, name_as_per_pan: nameAsPerPan }, 200);
  } catch (err: any) {
    console.error("public-pan-verify error:", err?.message);
    return json({ error: err?.message || "PAN verification failed. Please try again." }, 500);
  }
});
