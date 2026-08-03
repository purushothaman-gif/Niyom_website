import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DEVICE_DAYS, daysFromNow, hashPin, isValidPin, isWeakPin, newSalt } from "../_shared/pin.ts";

// employee-pin-set — sets/replaces a 4-digit device PIN for a CRM staff member.
// Requires a full session. IMPORTANT: only role = 'employee' may have a PIN;
// admins / super_admins are refused so their password + TOTP 2FA is never
// reducible to a 4-digit code. Mirrors client-pin-set for nw_employee_device_pins.

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

    const { data: emp } = await db
      .from("nw_employees").select("id, role, status").eq("auth_user_id", user.id).maybeSingle();
    if (!emp || emp.status !== "active") return json({ error: "Please sign in first." }, 403);
    if (emp.role !== "employee") {
      return json({ error: "PIN sign-in is not available for admin accounts. Please use your password and 2FA." }, 403);
    }

    const salt = newSalt();
    const { hash, iterations } = await hashPin(pin, salt);
    const { error: upErr } = await db.from("nw_employee_device_pins").upsert({
      employee_id: emp.id, device_id: deviceId, device_label: label,
      pin_hash: hash, pin_salt: salt, pin_iterations: iterations,
      failed_attempts: 0, locked_until: null, revoked_at: null,
      expires_at: daysFromNow(DEVICE_DAYS), updated_at: new Date().toISOString(),
    }, { onConflict: "employee_id,device_id" });
    if (upErr) { console.error("employee-pin-set upsert failed:", upErr.message); return json({ error: "Could not save your PIN. Please try again." }, 500); }

    return json({ success: true, expires_in_days: DEVICE_DAYS });
  } catch (err) {
    console.error("employee-pin-set error:", err instanceof Error ? err.message : err);
    return json({ error: "Could not save your PIN. Please try again." }, 500);
  }
});
