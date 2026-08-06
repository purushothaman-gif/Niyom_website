import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { asJson } from '../_shared/json.ts';

// Public function (verify_jwt = false). Step 1-2 of the CRM staff "Forgot
// Password with OTP" flow. Validates the email belongs to an active employee,
// then emails a cryptographically-secure 6-digit OTP (5 min expiry).
//
// EMAIL ENUMERATION SAFE: the response is identical whether or not the email
// is registered. The only observable difference (rate-limit 429) applies to
// registered emails only and never to the generic path.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Generic response — never reveals whether the email exists.
const GENERIC = { success: true, message: "If this email is registered, an OTP has been sent." };

const OTP_TTL_MS = 5 * 60 * 1000;        // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;    // one OTP per email per 60s
const HOURLY_REQUEST_CAP = 5;            // max OTP requests per email per hour
const ALLOWED_ROLES = ["admin", "super_admin", "employee"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Cryptographically secure 6-digit OTP with rejection sampling (no modulo bias).
function generateOTP(): string {
  const max = 1_000_000;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return (n % max).toString().padStart(6, "0");
}

async function hashOTP(otp: string, email: string): Promise<string> {
  const pepper = Deno.env.get("PASSWORD_RESET_OTP_PEPPER") ?? "";
  const data = new TextEncoder().encode(`${otp}:${email}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const log = (event: string, email?: string, metadata: Record<string, unknown> = {}) =>
      db.from("nw_password_reset_logs").insert({ email, event, ip, user_agent: userAgent, metadata: asJson(metadata) });

    const body = await req.json().catch(() => ({}));
    const email: string = (body.email || "").trim().toLowerCase();

    if (!email || !isValidEmail(email)) {
      await log("otp_request_invalid_email", email || undefined);
      return json(GENERIC); // never leak format info
    }

    // Verify the email belongs to an active staff member with an allowed role.
    const { data: employee } = await db
      .from("nw_employees")
      .select("id, email, status, role, auth_user_id")
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle();

    if (!employee || !employee.auth_user_id || !ALLOWED_ROLES.includes(employee.role)) {
      // Enumeration-safe: identical response, but log the attempt for monitoring.
      await log("otp_request_unknown_email", email);
      return json(GENERIC);
    }

    // --- Rate limiting (registered emails only) ---
    const now = Date.now();

    const { data: latest } = await db
      .from("nw_password_reset_otps")
      .select("created_at")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest && now - new Date(latest.created_at).getTime() < RESEND_COOLDOWN_MS) {
      await log("otp_request_rate_limited", email, { reason: "cooldown" });
      return json({ success: false, error: "Please wait a minute before requesting another code." }, 429);
    }

    const { count: hourlyCount } = await db
      .from("nw_password_reset_otps")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", new Date(now - 60 * 60 * 1000).toISOString());

    if ((hourlyCount ?? 0) >= HOURLY_REQUEST_CAP) {
      await log("otp_request_rate_limited", email, { reason: "hourly_cap" });
      return json({ success: false, error: "Too many reset requests. Please try again later." }, 429);
    }

    // --- Issue the OTP ---
    const otp = generateOTP();
    const otpHash = await hashOTP(otp, email);
    const expiresAt = new Date(now + OTP_TTL_MS).toISOString();

    // Invalidate any prior OTPs for this email, then store the fresh one.
    await db.from("nw_password_reset_otps").delete().eq("email", email);
    await db.from("nw_password_reset_otps").insert({
      email,
      employee_id: employee.id,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });
    // Best-effort sweep of globally expired rows.
    await db.from("nw_password_reset_otps").delete().lt("expires_at", new Date().toISOString());

    // --- Send the email via Resend ---
    const subject = "Password Reset OTP - Niyom Wealth Distribution LLP";
    const text =
      `Your OTP for password reset is: ${otp}\n` +
      `This OTP is valid for 5 minutes.\n` +
      `If you did not request this, please ignore this email.`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;background:#f6f6f6;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:10px;overflow:hidden;">
    <div style="background:#0B0B0F;padding:22px 24px;">
      <div style="font-size:20px;font-weight:700;color:#c9b896;">Niyom Wealth</div>
      <div style="font-size:12px;color:#8A8A8A;">Distribution LLP — CRM Platform</div>
    </div>
    <div style="padding:28px 24px;">
      <p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 8px;">Your OTP for password reset is:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#B8961E;
                  background:#FFF9EC;border:1px solid #D4AF37;border-radius:8px;
                  text-align:center;padding:18px 0;margin:16px 0;">${otp}</div>
      <p style="color:#555;font-size:13px;margin:0 0 6px;">This OTP is valid for <strong>5 minutes</strong>.</p>
      <p style="color:#555;font-size:13px;margin:0;">If you did not request this, please ignore this email.</p>
    </div>
    <div style="padding:14px 24px;font-size:11px;color:#aaa;border-top:1px solid #eee;">
      © 2026 Niyom Wealth Distribution LLP. This is an automated security message.
    </div>
  </div>
</body></html>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Niyom Wealth <support@niyomwealth.com>",
        to: [email],
        subject,
        html,
        text,
      }),
    });

    if (!resendResponse.ok) {
      const e = await resendResponse.json().catch(() => ({}));
      console.error("Resend error (send-reset-otp):", e);
      await log("otp_send_failed", email, { status: resendResponse.status });
      // Roll back the stored OTP so a failed send doesn't block a retry.
      await db.from("nw_password_reset_otps").delete().eq("email", email);
      return json({ success: false, error: "Could not send the OTP email. Please try again." }, 502);
    }

    await log("otp_sent", email, { employee_id: employee.id });
    return json(GENERIC);
  } catch (err: any) {
    console.error("send-reset-otp error:", err?.message);
    // Generic shape on unexpected failure (still enumeration-safe).
    return json(GENERIC);
  }
});
