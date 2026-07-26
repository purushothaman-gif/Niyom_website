import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, json, serviceClient,
  normalizePhone, isValidPhone, isValidEmail,
  generateOTP, persistOtp, deliverOtp, isRateLimited, maskEmail,
} from "../_shared/onboarding.ts";

// Sends (or resends) an email OTP for an existing onboarding account. Used for
// the "resend code" action and for return-login ("continue your application").
// Accepts either an { email } (return-login, since the code is emailed) or a
// { phone } (first-time resend). The OTP is always keyed on the client's phone
// in nw_otps and delivered to their email. Public (verify_jwt = false). Always
// returns a generic success to avoid leaking whether an account exists.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const phoneIn = normalizePhone(body.phone || "");
    const byEmail = isValidEmail(email);
    if (!byEmail && !isValidPhone(phoneIn)) {
      return json({ error: "Enter a valid email address." }, 400);
    }

    const db = serviceClient();

    // Only send if an account with a client login actually exists.
    const lookup = db
      .from("nw_clients")
      .select("id, email, phone")
      .eq("client_login_enabled", true);
    const { data: client } = await (byEmail
      ? lookup.eq("email", email)
      : lookup.eq("phone", phoneIn)).maybeSingle();

    let emailMasked = "your registered email";
    if (client && client.phone) {
      const otpKey = normalizePhone(client.phone);
      if (await isRateLimited(db, otpKey)) {
        return json({ error: "Please wait a minute before requesting another code." }, 429);
      }
      const code = generateOTP();
      await persistOtp(db, otpKey, code);
      await deliverOtp(otpKey, client.email || null, code);
      emailMasked = maskEmail(client.email);
    }

    // Generic response regardless of whether the account exists.
    return json({ success: true, email_masked: emailMasked }, 200);
  } catch (err: any) {
    console.error("public-onboard-send-otp error:", err?.message);
    return json({ error: "Could not send the code. Please try again." }, 500);
  }
});
