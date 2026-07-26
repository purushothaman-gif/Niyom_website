import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, serviceClient, isValidPan, panAlreadyRegistered } from "../_shared/onboarding.ts";
import { getPanGateway } from "../_shared/panGateway.ts";

// Public (verify_jwt=false) PAN verification for the FIRST step of the website
// self-signup — the visitor has no account yet, so unlike public-pan-verify
// (which needs a client session) this is anonymous. Body: { pan }.
//
// Order matters for cost: we look the PAN up in our own records FIRST and only
// call the paid Cashfree verify (via getPanGateway) for a PAN we don't already
// have. A light per-IP throttle protects the paid call from being spammed.

const THROTTLE_MAX = 15;        // verifies allowed per IP...
const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // ...per hour

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || "unknown";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const pan = (body.pan || "").trim().toUpperCase();
    if (!isValidPan(pan)) return json({ error: "Enter a valid PAN (e.g. ABCDE1234F)." }, 400);

    const db = serviceClient();

    // Per-IP throttle (sweep old rows, count the window, then record this call).
    const ip = clientIp(req);
    const since = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString();
    await db.from("nw_pan_verify_attempts").delete().lt("created_at", since);
    const { count } = await db
      .from("nw_pan_verify_attempts")
      .select("*", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= THROTTLE_MAX) {
      return json({ error: "Too many attempts. Please try again in a little while." }, 429);
    }
    await db.from("nw_pan_verify_attempts").insert({ ip });

    // Internal check FIRST — never pay Cashfree for a PAN we already hold.
    if (await panAlreadyRegistered(db, pan)) {
      return json({ already_registered: true }, 200);
    }

    const result = await getPanGateway().verify(pan);
    if (!result.valid) {
      return json({ valid: false, error: result.message || "PAN could not be verified." }, 422);
    }
    return json({ valid: true, name_as_per_pan: result.name_as_per_pan }, 200);
  } catch (err: any) {
    console.error("public-onboard-pan-verify error:", err?.message);
    return json({ error: err?.message || "PAN verification failed. Please try again." }, 500);
  }
});
