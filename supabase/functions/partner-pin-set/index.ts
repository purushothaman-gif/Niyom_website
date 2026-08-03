import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DEVICE_DAYS, daysFromNow, hashPin, isValidPin, isWeakPin, newSalt } from "../_shared/pin.ts";

// partner-pin-set — sets/replaces the 4-digit PIN for ONE device. Requires a
// full partner session (the DSA must already be signed in with their password),
// so the PIN is a second, device-bound factor, not a standalone credential.
// Mirrors client-pin-set for nw_dsa / nw_dsa_device_pins.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Please sign in first." }, 401);

    const body = await req.json().catch(() => ({}));
    const deviceId = String(body.device_id ?? "").trim();
    const pin = body.pin;
    const label = String(body.device_label ?? "").trim().slice(0, 60) || null;

    if (!/^[a-f0-9]{32,64}$/i.test(deviceId)) return json({ error: "Invalid device." }, 400);
    if (!isValidPin(pin)) return json({ error: "Your PIN must be exactly 4 digits." }, 400);
    if (isWeakPin(pin)) return json({ error: "That PIN is too easy to guess. Please choose another." }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await db.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "Please sign in first." }, 401);

    const { data: dsa } = await db
      .from("nw_dsa").select("id, dsa_login_enabled").eq("dsa_auth_user_id", user.id).maybeSingle();
    if (!dsa || !dsa.dsa_login_enabled) return json({ error: "Please sign in first." }, 403);

    const salt = newSalt();
    const { hash, iterations } = await hashPin(pin, salt);
    const { error: upErr } = await db.from("nw_dsa_device_pins").upsert({
      dsa_id: dsa.id, device_id: deviceId, device_label: label,
      pin_hash: hash, pin_salt: salt, pin_iterations: iterations,
      failed_attempts: 0, locked_until: null, revoked_at: null,
      expires_at: daysFromNow(DEVICE_DAYS), updated_at: new Date().toISOString(),
    }, { onConflict: "dsa_id,device_id" });
    if (upErr) { console.error("partner-pin-set upsert failed:", upErr.message); return json({ error: "Could not save your PIN. Please try again." }, 500); }

    return json({ success: true, expires_in_days: DEVICE_DAYS });
  } catch (err) {
    console.error("partner-pin-set error:", err instanceof Error ? err.message : err);
    return json({ error: "Could not save your PIN. Please try again." }, 500);
  }
});
