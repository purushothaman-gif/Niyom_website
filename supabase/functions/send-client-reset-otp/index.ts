import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public function (verify_jwt = false). Step 1 of the CLIENT (wealth-portal)
// "Forgot Password" flow. The client identifies by PAN; we look up their
// registered email and send a cryptographically-secure 6-digit OTP (5 min
// expiry) via Resend. A code — not a magic link — because email security
// scanners silently pre-open links and burn the one-time token, which is what
// made the old link flow show "link expired" on first click.
//
// PAN-ENUMERATION SAFE: the response is identical whether or not the PAN is
// registered (the only difference, a 429, applies to registered PANs only).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GENERIC = { success: true, message: "If your PAN is registered, a 6-digit code has been sent to your registered email." };

const OTP_TTL_MS = 5 * 60 * 1000;        // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;    // one OTP per PAN per 60s
const HOURLY_REQUEST_CAP = 5;            // max OTP requests per PAN per hour

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

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

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const log = (event: string, email?: string, metadata: Record<string, unknown> = {}) =>
      db.from("nw_password_reset_logs").insert({ email, event, ip, user_agent: userAgent, metadata: { surface: "client", ...metadata } });

    const body = await req.json().catch(() => ({}));
    const pan: string = (body.pan || "").trim().toUpperCase();

    if (!pan || !PAN_RE.test(pan)) {
      await log("client_otp_request_invalid_pan");
      return json(GENERIC);
    }

    // Resolve PAN → an active, login-enabled client with an email + auth user.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, email, client_login_enabled, client_auth_user_id")
      .eq("pan", pan)
      .eq("client_login_enabled", true)
      .maybeSingle();

    if (!client || !client.client_auth_user_id || !client.email) {
      await log("client_otp_request_unknown_pan");
      return json(GENERIC); // enumeration-safe
    }

    const email = String(client.email).trim().toLowerCase();
    const now = Date.now();

    // --- Rate limiting (registered PANs only), keyed by client_id ---
    const { data: latest } = await db
      .from("nw_client_password_reset_otps")
      .select("created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest && now - new Date(latest.created_at).getTime() < RESEND_COOLDOWN_MS) {
      await log("client_otp_rate_limited", email, { reason: "cooldown" });
      return json({ success: false, error: "Please wait a minute before requesting another code." }, 429);
    }

    const { count: hourlyCount } = await db
      .from("nw_client_password_reset_otps")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .gte("created_at", new Date(now - 60 * 60 * 1000).toISOString());

    if ((hourlyCount ?? 0) >= HOURLY_REQUEST_CAP) {
      await log("client_otp_rate_limited", email, { reason: "hourly_cap" });
      return json({ success: false, error: "Too many reset requests. Please try again later." }, 429);
    }

    // --- Issue the OTP ---
    const otp = generateOTP();
    const otpHash = await hashOTP(otp, email);
    const expiresAt = new Date(now + OTP_TTL_MS).toISOString();

    await db.from("nw_client_password_reset_otps").delete().eq("client_id", client.id);
    await db.from("nw_client_password_reset_otps").insert({
      email,
      client_id: client.id,
      otp_hash: otpHash,
      expires_at: expiresAt,
    });
    // Best-effort global sweep of expired rows.
    await db.from("nw_client_password_reset_otps").delete().lt("expires_at", new Date().toISOString());

    // --- Send the code via Resend ---
    const subject = "Your password reset code - Niyom Wealth";
    const text =
      `Your Niyom Wealth password reset code is: ${otp}\n` +
      `This code is valid for 5 minutes.\n` +
      `If you did not request this, please ignore this email.`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;background:#f6f6f6;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:10px;overflow:hidden;">
    <div style="background:#081B33;padding:22px 24px;">
      <div style="font-size:20px;font-weight:700;color:#c9b896;">Niyom Wealth</div>
      <div style="font-size:12px;color:#8A8A8A;">Distribution LLP — Client Portal</div>
    </div>
    <div style="padding:28px 24px;">
      <p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 8px;">Use this code to reset your Niyom Wealth account password:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#B8961E;
                  background:#FFF9EC;border:1px solid #D4AF37;border-radius:8px;
                  text-align:center;padding:18px 0;margin:16px 0;">${otp}</div>
      <p style="color:#555;font-size:13px;margin:0 0 6px;">This code is valid for <strong>5 minutes</strong>.</p>
      <p style="color:#555;font-size:13px;margin:0;">If you did not request this, you can safely ignore this email.</p>
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
      console.error("Resend error (send-client-reset-otp):", e);
      await log("client_otp_send_failed", email, { status: resendResponse.status });
      await db.from("nw_client_password_reset_otps").delete().eq("client_id", client.id);
      return json({ success: false, error: "Could not send the code email. Please try again." }, 502);
    }

    await log("client_otp_sent", email, { client_id: client.id });
    return json(GENERIC);
  } catch (err: any) {
    console.error("send-client-reset-otp error:", err?.message);
    return json(GENERIC);
  }
});
