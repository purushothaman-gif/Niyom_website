// Shared helpers for the conversion-first public onboarding flow.
// Used by public-onboard-start / -send-otp / -verify-otp / -pan-verify /
// -record-doc / -submit. Kept small and dependency-light (Deno + supabase-js).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// All public walk-in clients are mapped to employee NIYOM-001 (same as the
// legacy public-client-onboard function).
export const NIYOM_DEFAULT_EMPLOYEE_ID = "1b543112-3251-4912-847b-92982f2de563";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// India mobile → bare 10-digit form (drops +91 / 91 / 0 prefixes and spaces).
export function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits.slice(-10);
}

export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function maskPhone(phone: string): string {
  if (phone.length !== 10) return "your mobile";
  return `${phone.slice(0, 2)}${"*".repeat(4)}${phone.slice(6)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "your email";
  const [user, domain] = email.split("@");
  if (!domain) return "your email";
  return `${user.slice(0, 2)}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

// One OTP per phone per 60s. Returns true when the caller should be throttled.
export async function isRateLimited(db: SupabaseClient, phone: string): Promise<boolean> {
  const { data: recent } = await db
    .from("nw_otps")
    .select("created_at")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !!recent && Date.now() - new Date(recent.created_at).getTime() < 60_000;
}

// Persist a fresh OTP (replacing any prior one for this phone) and sweep expired
// rows. Mirrors the existing send-otp function's storage contract on nw_otps.
export async function persistOtp(db: SupabaseClient, phone: string, code: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.from("nw_otps").delete().eq("phone", phone);
  await db.from("nw_otps").insert({ phone, otp: code, expires_at: expiresAt });
  await db.from("nw_otps").delete().lt("expires_at", new Date().toISOString());
}

// Deliver the OTP by email via Resend. (SMS delivery was removed — the MSG91
// account KYC gating made SMS unreliable, so email is the single channel.)
// The code is always persisted first, so verification still works if delivery
// fails. `phone` is retained in the signature as the OTP key but unused here.
export async function deliverOtp(_phone: string, email: string | null, code: string): Promise<void> {
  console.log(`[onboarding OTP] ${email ?? "-"}: ${code}`);
  if (email) await deliverOtpEmail(email, code);
}

async function deliverOtpEmail(email: string, code: string): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;
  const subject = "Your Niyom Wealth verification code";
  const text = `Your Niyom Wealth verification code is ${code}. It is valid for 10 minutes. If you did not request this, please ignore this email.`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:520px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Use the code below to verify your mobile and open your free account:</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#B8961E;background:#FFF9EC;border:1px solid #D4AF37;border-radius:8px;text-align:center;padding:16px 0;margin:18px 0;">${code}</div>
    <p style="margin:0 0 14px;color:#555;font-size:13px;">This code is valid for 10 minutes. Niyom Wealth will never ask you to share it.</p>
    <p style="margin:18px 0 0;color:#111;font-weight:600;">Niyom Wealth Distribution LLP</p>
  </div>
</body></html>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Niyom Wealth <support@niyomwealth.com>", to: [email], subject, html, text }),
    });
    if (!res.ok) console.error(`[Resend OTP] status=${res.status} body=${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.error("[Resend OTP] send failed:", (e as any)?.message);
  }
}

// Verify a submitted OTP for a phone. Consumes (deletes) the row on success.
export async function checkOtp(
  db: SupabaseClient,
  phone: string,
  otp: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: stored } = await db
    .from("nw_otps")
    .select("otp, expires_at")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!stored) return { ok: false, error: "No OTP found. Please request a new one." };
  if (new Date(stored.expires_at) < new Date()) {
    await db.from("nw_otps").delete().eq("phone", phone);
    return { ok: false, error: "OTP expired. Please request a new one." };
  }
  if (stored.otp !== otp.trim()) return { ok: false, error: "Incorrect OTP. Please try again." };

  await db.from("nw_otps").delete().eq("phone", phone);
  return { ok: true };
}

// True when a client with this PAN already exists in our records. Both PAN-verify
// endpoints call this FIRST so an already-registered PAN never hits the paid
// Cashfree verify. PAN is stored uppercase on nw_clients.
export async function panAlreadyRegistered(db: SupabaseClient, pan: string): Promise<boolean> {
  const { data } = await db
    .from("nw_clients")
    .select("id")
    .eq("pan", pan.trim().toUpperCase())
    .limit(1);
  return !!(data && data.length > 0);
}
