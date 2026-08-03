import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ATTEMPTS_BEFORE_BURN, ATTEMPTS_BEFORE_LOCK, DEVICE_DAYS, LOCK_MINUTES,
  daysFromNow, isValidPin, minutesFromNow, verifyPin,
} from "../_shared/pin.ts";

// partner-pin-login — signs a DSA in with (device_id, pin). Counting/lockout is
// server-side (5 wrong → 15-min lock; 10 → burned). On success mints a one-time
// magic-link token the browser exchanges via verifyOtp on partnerSupabase.
// Mirrors client-pin-login for nw_dsa / nw_dsa_device_pins.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const WRONG = { code: "wrong_pin", error: "That PIN doesn't match. Please try again." };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const deviceId = String(body.device_id ?? "").trim();
    const pin = body.pin;
    const dsaId = String(body.dsa_id ?? "").trim();

    if (!/^[a-f0-9]{32,64}$/i.test(deviceId) || !isValidPin(pin)) return json(WRONG, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let query = db.from("nw_dsa_device_pins")
      .select("id, dsa_id, pin_hash, pin_salt, pin_iterations, failed_attempts, locked_until, revoked_at, expires_at")
      .eq("device_id", deviceId).is("revoked_at", null);
    if (dsaId) query = query.eq("dsa_id", dsaId);
    const { data: rows } = await query.limit(2);

    const row = rows?.length === 1 ? rows[0] : null;
    if (!row) return json(WRONG, 401);

    const now = Date.now();
    if (new Date(row.expires_at).getTime() < now) {
      await db.from("nw_dsa_device_pins").update({ revoked_at: new Date().toISOString() }).eq("id", row.id);
      return json({ code: "expired", error: "This device's PIN has expired. Please sign in with your password." }, 401);
    }
    if (row.locked_until && new Date(row.locked_until).getTime() > now) {
      const mins = Math.ceil((new Date(row.locked_until).getTime() - now) / 60000);
      return json({ code: "locked", error: `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` }, 429);
    }

    const ok = await verifyPin(pin, row.pin_salt, row.pin_iterations, row.pin_hash);
    if (!ok) {
      const attempts = (row.failed_attempts ?? 0) + 1;
      const burn = attempts >= ATTEMPTS_BEFORE_BURN;
      await db.from("nw_dsa_device_pins").update({
        failed_attempts: attempts,
        locked_until: !burn && attempts % ATTEMPTS_BEFORE_LOCK === 0 ? minutesFromNow(LOCK_MINUTES) : row.locked_until,
        revoked_at: burn ? new Date().toISOString() : null,
      }).eq("id", row.id);
      if (burn) return json({ code: "burned", error: "PIN sign-in is disabled on this device. Please sign in with your password." }, 401);
      if (attempts % ATTEMPTS_BEFORE_LOCK === 0) return json({ code: "locked", error: `Too many wrong tries. Try again in ${LOCK_MINUTES} minutes.` }, 429);
      return json({ ...WRONG, remaining: ATTEMPTS_BEFORE_LOCK - (attempts % ATTEMPTS_BEFORE_LOCK) }, 401);
    }

    const { data: dsa } = await db
      .from("nw_dsa").select("id, email, dsa_login_enabled, dsa_password_changed").eq("id", row.dsa_id).maybeSingle();
    if (!dsa || !dsa.dsa_login_enabled || !dsa.email) return json(WRONG, 401);

    const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email: dsa.email });
    if (linkErr || !link?.properties?.hashed_token) {
      console.error("partner-pin-login link failed:", linkErr?.message);
      return json({ code: "error", error: "Could not sign you in. Please try again." }, 500);
    }

    await db.from("nw_dsa_device_pins").update({
      failed_attempts: 0, locked_until: null, last_used_at: new Date().toISOString(), expires_at: daysFromNow(DEVICE_DAYS),
    }).eq("id", row.id);

    return json({ success: true, dsa_id: dsa.id, token_hash: link.properties.hashed_token, password_changed: dsa.dsa_password_changed });
  } catch (err) {
    console.error("partner-pin-login error:", err instanceof Error ? err.message : err);
    return json({ code: "error", error: "Could not sign you in. Please try again." }, 500);
  }
});
