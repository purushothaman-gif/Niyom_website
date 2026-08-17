import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, json, serviceClient,
  normalizePhone, isValidPhone, isValidEmail, checkOtp,
} from "../_shared/onboarding.ts";

// Partner (DSA) self-onboarding — step 2. Verifies the mobile OTP for a
// self-registered DSA and returns a one-time magic-link token the partner-onboarding
// page exchanges on partnerSupabase to establish a session. The partner then
// lands in the portal, where dsa_password_changed=false forces them to set a
// password before continuing. Public (verify_jwt = false); mirrors
// public-onboard-verify-otp for nw_dsa.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const phoneIn = normalizePhone(body.phone || "");
    const otp = (body.otp || "").trim();
    const byEmail = isValidEmail(email);
    if ((!byEmail && !isValidPhone(phoneIn)) || !otp) {
      return json({ error: "Enter the 6-digit code sent to your email." }, 400);
    }

    const db = serviceClient();

    const lookup = db
      .from("nw_dsa")
      .select("id, full_name, email, mobile, dsa_password_changed")
      .eq("dsa_login_enabled", true);
    const { data: dsa } = await (byEmail ? lookup.eq("email", email) : lookup.eq("mobile", phoneIn)).maybeSingle();

    if (!dsa || !dsa.email || !dsa.mobile) {
      return json({ error: "No partner account found for these details." }, 404);
    }

    const phone = normalizePhone(dsa.mobile);
    const result = await checkOtp(db, phone, otp);
    if (!result.ok) return json({ error: result.error }, 400);

    // Mint a one-time magic-link token for programmatic sign-in.
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: dsa.email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      throw linkErr || new Error("Could not create a sign-in token.");
    }

    return json({
      success: true,
      dsa_id: dsa.id,
      email: dsa.email,
      token_hash: link.properties.hashed_token,
      password_changed: dsa.dsa_password_changed,
    }, 200);
  } catch (err: any) {
    console.error("public-partner-onboard-verify error:", err?.message);
    return json({ error: err?.message || "An unexpected error occurred." }, 500);
  }
});
