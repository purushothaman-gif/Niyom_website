import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ATTEMPTS_BEFORE_BURN,
  ATTEMPTS_BEFORE_LOCK,
  DEVICE_DAYS,
  LOCK_MINUTES,
  daysFromNow,
  isValidPin,
  minutesFromNow,
  verifyPin,
} from "../_shared/pin.ts";

/**
 * client-pin-login
 * ----------------
 * Signs a client in with (device_id, pin). This is the only place the counting
 * happens, because a four-digit secret is safe only while something upstream of
 * the guesser is keeping score:
 *
 *   - 5 consecutive wrong tries  → the device cools off for 15 minutes;
 *   - 10 wrong tries in total    → the PIN is burned; a full login is required.
 *
 * Every failure returns the SAME message whether the device is unknown, the
 * PIN is wrong, or the client's portal access was disabled — otherwise this
 * endpoint would answer "does device X exist" for anyone who asks.
 *
 * On success it mints a one-time magic-link token and hands back the hash for
 * the browser to exchange via verifyOtp, exactly as the email-OTP login does.
 * No session is ever constructed client-side.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** One wrong-PIN answer, whatever actually went wrong. */
const WRONG = { code: "wrong_pin", error: "That PIN doesn't match. Please try again." };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const deviceId = String(body.device_id ?? "").trim();
    const pin = body.pin;
    /*
     * Which account on this device. One browser can hold a PIN for several
     * clients — a family sharing a laptop — so the caller names the one it is
     * unlocking. It is only a selector: the PIN still has to match THAT row.
     */
    const clientId = String(body.client_id ?? "").trim();

    if (!/^[a-f0-9]{32,64}$/i.test(deviceId) || !isValidPin(pin)) return json(WRONG, 401);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = db
      .from("nw_client_device_pins")
      .select(
        "id, client_id, pin_hash, pin_salt, pin_iterations, failed_attempts, locked_until, revoked_at, expires_at",
      )
      .eq("device_id", deviceId)
      .is("revoked_at", null);

    if (clientId) query = query.eq("client_id", clientId);

    const { data: rows } = await query.limit(2);

    /*
     * No client_id and more than one account on the device: the browser has to
     * say which. Answered as a plain wrong-PIN so this cannot be used to count
     * the accounts on someone else's machine.
     */
    const row = rows?.length === 1 ? rows[0] : null;
    if (!row) return json(WRONG, 401);

    const now = Date.now();

    if (new Date(row.expires_at).getTime() < now) {
      await db.from("nw_client_device_pins").update({ revoked_at: new Date().toISOString() }).eq("id", row.id);
      return json(
        { code: "expired", error: "This device's PIN has expired. Please sign in with your password." },
        401,
      );
    }

    if (row.locked_until && new Date(row.locked_until).getTime() > now) {
      const mins = Math.ceil((new Date(row.locked_until).getTime() - now) / 60000);
      return json(
        { code: "locked", error: `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
        429,
      );
    }

    const ok = await verifyPin(pin, row.pin_salt, row.pin_iterations, row.pin_hash);

    if (!ok) {
      const attempts = (row.failed_attempts ?? 0) + 1;
      const burn = attempts >= ATTEMPTS_BEFORE_BURN;
      await db
        .from("nw_client_device_pins")
        .update({
          failed_attempts: attempts,
          locked_until:
            !burn && attempts % ATTEMPTS_BEFORE_LOCK === 0 ? minutesFromNow(LOCK_MINUTES) : row.locked_until,
          revoked_at: burn ? new Date().toISOString() : null,
        })
        .eq("id", row.id);

      if (burn) {
        return json(
          { code: "burned", error: "PIN sign-in is disabled on this device. Please sign in with your password." },
          401,
        );
      }
      if (attempts % ATTEMPTS_BEFORE_LOCK === 0) {
        return json(
          { code: "locked", error: `Too many wrong tries. Try again in ${LOCK_MINUTES} minutes.` },
          429,
        );
      }
      return json({ ...WRONG, remaining: ATTEMPTS_BEFORE_LOCK - (attempts % ATTEMPTS_BEFORE_LOCK) }, 401);
    }

    // Correct PIN — but the client record still decides whether they may in.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, email, client_login_enabled, client_password_changed")
      .eq("id", row.client_id)
      .maybeSingle();

    if (!client || !client.client_login_enabled || !client.email) return json(WRONG, 401);

    const { data: link, error: linkErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: client.email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      console.error("client-pin-login link failed:", linkErr?.message);
      return json({ code: "error", error: "Could not sign you in. Please try again." }, 500);
    }

    await db
      .from("nw_client_device_pins")
      .update({
        failed_attempts: 0,
        locked_until: null,
        last_used_at: new Date().toISOString(),
        // Using the device keeps it remembered; going quiet lets it lapse.
        expires_at: daysFromNow(DEVICE_DAYS),
      })
      .eq("id", row.id);

    return json({
      success: true,
      client_id: client.id,
      token_hash: link.properties.hashed_token,
      password_changed: client.client_password_changed,
    });
  } catch (err) {
    console.error("client-pin-login error:", err instanceof Error ? err.message : err);
    return json({ code: "error", error: "Could not sign you in. Please try again." }, 500);
  }
});
