import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { asJson } from '../_shared/json.ts';

// Public function (verify_jwt = false). Steps 3-4 of the CRM staff "Forgot
// Password with OTP" flow.
//
//   action: "verify"  -> validate the OTP (expiry / attempts / match) WITHOUT
//                         consuming it, so the UI can advance to the password
//                         screen. Wrong codes increment the attempt counter;
//                         after 3 the OTP is destroyed (brute-force guard).
//
//   action: "reset"   -> re-validate the OTP, validate password strength, set
//                         the new password via the Auth admin API (bcrypt-
//                         hashed by Supabase), then mark the OTP used so it can
//                         never be replayed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_ATTEMPTS = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashOTP(otp: string, email: string): Promise<string> {
  const pepper = Deno.env.get("PASSWORD_RESET_OTP_PEPPER") ?? "";
  const data = new TextEncoder().encode(`${otp}:${email}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time-ish comparison of two equal-length hex strings.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Shared password policy (also enforced client-side). Returns null if OK.
function passwordError(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 72) return "Password must be 72 characters or fewer.";
  if (!/[a-z]/.test(pw)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must include a symbol.";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const log = (event: string, email?: string, metadata: Record<string, unknown> = {}) =>
      db.from("nw_password_reset_logs").insert({ email, event, ip, user_agent: userAgent, metadata: asJson(metadata) });

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    const email: string = (body.email || "").trim().toLowerCase();
    const otp: string = String(body.otp || "").trim();

    if (action !== "verify" && action !== "reset") {
      return json({ success: false, error: "Invalid request." }, 400);
    }
    if (!email || !isValidEmail(email) || !/^\d{6}$/.test(otp)) {
      return json({ success: false, error: "Invalid email or code." }, 400);
    }

    // Load the active OTP for this email.
    const { data: row } = await db
      .from("nw_password_reset_otps")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row || row.used) {
      await log("verify_no_otp", email);
      return json({ success: false, error: "No active code found. Please request a new one." }, 400);
    }
    if (new Date(row.expires_at) < new Date()) {
      await db.from("nw_password_reset_otps").delete().eq("id", row.id);
      await log("verify_expired", email);
      return json({ success: false, error: "This code has expired. Please request a new one." }, 400);
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await db.from("nw_password_reset_otps").delete().eq("id", row.id);
      await log("verify_max_attempts", email);
      return json({ success: false, error: "Too many incorrect attempts. Please request a new code." }, 429);
    }

    const candidate = await hashOTP(otp, email);
    if (!safeEqual(candidate, row.otp_hash)) {
      const attempts = row.attempts + 1;
      await db.from("nw_password_reset_otps").update({ attempts }).eq("id", row.id);
      const remaining = MAX_ATTEMPTS - attempts;
      await log("verify_failed", email, { attempts });
      if (remaining <= 0) {
        await db.from("nw_password_reset_otps").delete().eq("id", row.id);
        return json({ success: false, error: "Too many incorrect attempts. Please request a new code." }, 429);
      }
      return json({
        success: false,
        error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
      }, 400);
    }

    // OTP is valid from here on.
    if (action === "verify") {
      await log("verify_success", email);
      return json({ success: true, verified: true });
    }

    // action === "reset": validate the new password, then apply it.
    const pwErr = passwordError(body.password);
    if (pwErr) return json({ success: false, error: pwErr }, 400);

    const { data: employee } = await db
      .from("nw_employees")
      .select("id, auth_user_id, status")
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle();

    if (!employee || !employee.auth_user_id) {
      await log("reset_no_employee", email);
      return json({ success: false, error: "Account not found." }, 400);
    }

    const { error: updErr } = await db.auth.admin.updateUserById(employee.auth_user_id, {
      password: body.password,
    });
    if (updErr) {
      await log("reset_update_failed", email, { message: updErr.message });
      return json({ success: false, error: "Could not update the password. Please try again." }, 500);
    }

    // Consume the OTP immediately so it can never be reused.
    await db.from("nw_password_reset_otps").update({ used: true }).eq("id", row.id);
    await db.from("nw_password_reset_otps").delete().eq("email", email);

    // NOTE: we intentionally do NOT touch nw_employees here. The reset is kept
    // strictly isolated to the OTP/log tables + the user's own auth password.
    await log("password_reset", email, { employee_id: employee.id });
    return json({ success: true, message: "Password updated. You can now sign in." });
  } catch (err: any) {
    console.error("reset-password-with-otp error:", err?.message);
    return json({ success: false, error: "Internal error." }, 500);
  }
});
