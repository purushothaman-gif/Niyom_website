import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient, isValidPan } from "../_shared/onboarding.ts";

// Onboarding PAN step via DigiLocker.
//
// The DigiLocker consent flow (run on the droplet) writes the verified identity
// — name, PAN, DOB — into digilocker_sessions. This function promotes that into
// the client's record exactly as public-pan-verify does for Cashfree: it sets
// pan / pan_name / pan_verified so the onboarding checklist and wizard treat the
// PAN step as done. Requires the CLIENT's own Supabase session (Bearer) and
// confirms the session owns the client_id, so it can't be run anonymously.
//
// It never calls DigiLocker itself — it only reads what the consent callback
// already stored — so it is safe to retry and needs no vendor key of its own.

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
    if (!client_id) return json({ error: "Missing client." }, 400);

    const db = serviceClient();

    // The session must own this client record.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, dob, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) {
      return json({ error: "Unauthorized" }, 403);
    }

    // Read the latest VERIFIED DigiLocker session for this client.
    const { data: session } = await db
      .from("digilocker_sessions")
      .select("dl_pan, dl_name, dl_dob, status, verified_at")
      .eq("client_id", client_id)
      .eq("status", "verified")
      .order("verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return json({ error: "Please complete DigiLocker verification first." }, 422);
    }

    const pan = (session.dl_pan || "").trim().toUpperCase();
    if (!isValidPan(pan)) {
      return json({
        error: "DigiLocker did not return a valid PAN. Please try again or contact support.",
      }, 422);
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

    const nameAsPerPan = (session.dl_name || "").trim() || client.full_name;

    // Promote into the client record. DOB is only filled when we don't already
    // have one (never overwrite a value the client entered).
    const update: Record<string, unknown> = {
      pan,
      pan_name: nameAsPerPan,
      pan_verified: true,
    };
    if (!client.dob && session.dl_dob) update.dob = session.dl_dob;

    await db.from("nw_clients").update(update).eq("id", client_id);

    await db.from("nw_activity_logs").insert([{
      client_id,
      action: "PAN Verified",
      description: `PAN verified via DigiLocker. Name as per PAN: ${nameAsPerPan}.`,
    }]);

    return json({
      success: true,
      valid: true,
      name_as_per_pan: nameAsPerPan,
      pan,
    }, 200);
  } catch (err: any) {
    console.error("public-digilocker-apply error:", err?.message);
    return json({ error: err?.message || "Verification failed. Please try again." }, 500);
  }
});
