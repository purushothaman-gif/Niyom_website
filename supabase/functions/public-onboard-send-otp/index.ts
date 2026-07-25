import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, json, serviceClient,
  normalizePhone, isValidPhone,
  generateOTP, persistOtp, deliverOtp, isRateLimited, maskEmail,
} from "../_shared/onboarding.ts";

// Sends (or resends) a mobile OTP for an existing onboarding account. Used for
// the "resend code" action and for return-login ("continue your application").
// Public (verify_jwt = false). Always returns a generic success to avoid
// leaking whether a phone is registered.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(body.phone || "");
    if (!isValidPhone(phone)) return json({ error: "Enter a valid 10-digit mobile number." }, 400);

    const db = serviceClient();

    // Only send if an account with a client login actually exists for this phone.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, email")
      .eq("phone", phone)
      .eq("client_login_enabled", true)
      .maybeSingle();

    let emailMasked = "your registered email";
    if (client) {
      if (await isRateLimited(db, phone)) {
        return json({ error: "Please wait a minute before requesting another code." }, 429);
      }
      const code = generateOTP();
      await persistOtp(db, phone, code);
      await deliverOtp(phone, client.email || null, code);
      emailMasked = maskEmail(client.email);
    }

    // Generic response regardless of whether the phone exists.
    return json({ success: true, email_masked: emailMasked }, 200);
  } catch (err: any) {
    console.error("public-onboard-send-otp error:", err?.message);
    return json({ error: "Could not send the code. Please try again." }, 500);
  }
});
