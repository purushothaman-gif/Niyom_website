import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public function (verify_jwt = false). Step 1 of the PARTNER (DSA) "Forgot
// Password" flow. The partner identifies by PAN; we look up their registered
// email and send a 6-digit OTP (5 min expiry) via Resend. A code — not a magic
// link — because email scanners pre-consume one-time links.
//
// PAN-ENUMERATION SAFE: identical response whether or not the PAN is registered.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GENERIC = { success: true, message: "If your PAN is registered, a 6-digit code has been sent to your registered email." };

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const HOURLY_REQUEST_CAP = 5;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function generateOTP(): string {
  const max = 1_000_000;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= limit);
  return (n % max).toString().padStart(6, "0");
}

async function hashOTP(otp: string, email: string): Promise<string> {
  const pepper = Deno.env.get("PASSWORD_RESET_OTP_PEPPER") ?? "";
  const data = new TextEncoder().encode(`${otp}:${email}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ip = req.headers.get("x-forwarded-for") ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const log = (event: string, email?: string, metadata: Record<string, unknown> = {}) =>
      db.from("nw_password_reset_logs").insert({ email, event, ip, user_agent: userAgent, metadata: { surface: "partner", ...metadata } });

    const body = await req.json().catch(() => ({}));
    const pan: string = (body.pan || "").trim().toUpperCase();
    if (!pan || !PAN_RE.test(pan)) { await log("partner_otp_request_invalid_pan"); return json(GENERIC); }

    const { data: dsa } = await db
      .from("nw_dsa")
      .select("id, email, dsa_login_enabled, dsa_auth_user_id")
      .eq("pan", pan)
      .eq("dsa_login_enabled", true)
      .maybeSingle();

    if (!dsa || !dsa.dsa_auth_user_id || !dsa.email) { await log("partner_otp_request_unknown_pan"); return json(GENERIC); }

    const email = String(dsa.email).trim().toLowerCase();
    const now = Date.now();

    const { data: latest } = await db
      .from("nw_dsa_password_reset_otps")
      .select("created_at").eq("dsa_id", dsa.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latest && now - new Date(latest.created_at).getTime() < RESEND_COOLDOWN_MS) {
      await log("partner_otp_rate_limited", email, { reason: "cooldown" });
      return json({ success: false, error: "Please wait a minute before requesting another code." }, 429);
    }

    const { count: hourlyCount } = await db
      .from("nw_dsa_password_reset_otps")
      .select("id", { count: "exact", head: true })
      .eq("dsa_id", dsa.id).gte("created_at", new Date(now - 60 * 60 * 1000).toISOString());
    if ((hourlyCount ?? 0) >= HOURLY_REQUEST_CAP) {
      await log("partner_otp_rate_limited", email, { reason: "hourly_cap" });
      return json({ success: false, error: "Too many reset requests. Please try again later." }, 429);
    }

    const otp = generateOTP();
    const otpHash = await hashOTP(otp, email);
    await db.from("nw_dsa_password_reset_otps").delete().eq("dsa_id", dsa.id);
    await db.from("nw_dsa_password_reset_otps").insert({
      email, dsa_id: dsa.id, otp_hash: otpHash, expires_at: new Date(now + OTP_TTL_MS).toISOString(),
    });
    await db.from("nw_dsa_password_reset_otps").delete().lt("expires_at", new Date().toISOString());

    const subject = "Your partner password reset code - Niyom Wealth";
    const text = `Your Niyom Wealth Partner password reset code is: ${otp}\nThis code is valid for 5 minutes.\nIf you did not request this, please ignore this email.`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;background:#f6f6f6;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:10px;overflow:hidden;">
    <div style="background:#081B33;padding:22px 24px;">
      <div style="font-size:20px;font-weight:700;color:#c9b896;">Niyom Wealth</div>
      <div style="font-size:12px;color:#8A8A8A;">Distribution LLP — Partner Portal</div>
    </div>
    <div style="padding:28px 24px;">
      <p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 8px;">Use this code to reset your Niyom Wealth Partner password:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#B8961E;background:#FFF9EC;border:1px solid #D4AF37;border-radius:8px;text-align:center;padding:18px 0;margin:16px 0;">${otp}</div>
      <p style="color:#555;font-size:13px;margin:0 0 6px;">This code is valid for <strong>5 minutes</strong>.</p>
      <p style="color:#555;font-size:13px;margin:0;">If you did not request this, you can safely ignore this email.</p>
    </div>
    <div style="padding:14px 24px;font-size:11px;color:#aaa;border-top:1px solid #eee;">© 2026 Niyom Wealth Distribution LLP. Automated security message.</div>
  </div>
</body></html>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Niyom Wealth <support@niyomwealth.com>", to: [email], subject, html, text }),
    });
    if (!resendResponse.ok) {
      const e = await resendResponse.json().catch(() => ({}));
      console.error("Resend error (send-partner-reset-otp):", e);
      await log("partner_otp_send_failed", email, { status: resendResponse.status });
      await db.from("nw_dsa_password_reset_otps").delete().eq("dsa_id", dsa.id);
      return json({ success: false, error: "Could not send the code email. Please try again." }, 502);
    }

    await log("partner_otp_sent", email, { dsa_id: dsa.id });
    return json(GENERIC);
  } catch (err: any) {
    console.error("send-partner-reset-otp error:", err?.message);
    return json(GENERIC);
  }
});
