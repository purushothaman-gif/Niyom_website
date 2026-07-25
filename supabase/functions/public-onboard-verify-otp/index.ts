import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, json, serviceClient,
  normalizePhone, isValidPhone, checkOtp,
} from "../_shared/onboarding.ts";

// Verifies a mobile OTP and returns a magic-link token the client exchanges for
// a live Supabase session (no password on the wire). Serves both first-time
// verification (Step 1) and return-login. Public (verify_jwt = false).

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(body.phone || "");
    const otp = (body.otp || "").trim();
    if (!isValidPhone(phone) || !otp) {
      return json({ error: "Enter the 6-digit code sent to your mobile." }, 400);
    }

    const db = serviceClient();

    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, email, onboarding_status, phone_verified, client_password_changed")
      .eq("phone", phone)
      .eq("client_login_enabled", true)
      .maybeSingle();

    if (!client || !client.email) {
      return json({ error: "No account found for this mobile number." }, 404);
    }

    const result = await checkOtp(db, phone, otp);
    if (!result.ok) return json({ error: result.error }, 400);

    // First-time verification advances the funnel; return-login leaves it be.
    const firstTime = client.onboarding_status === "account_created";
    const patch: Record<string, unknown> = { phone_verified: true };
    if (firstTime) patch.onboarding_status = "kyc_in_progress";
    await db.from("nw_clients").update(patch).eq("id", client.id);

    // On first OTP verify, register this public signup as a SELF-GENERATED lead
    // in the CRM (admin pool) so an RM can be assigned. Idempotent — never a
    // second lead for the same client.
    if (firstTime) {
      const { data: existingLead } = await db
        .from("nw_leads")
        .select("id")
        .eq("converted_client_id", client.id)
        .eq("lead_origin", "website_signup")
        .maybeSingle();
      if (!existingLead) {
        await db.from("nw_leads").insert([{
          lead_name: client.full_name || "Website Signup",
          mobile: phone,
          email: client.email,
          lead_origin: "website_signup",
          lead_source: "Website Sign-up",
          status: "New",
          owner_employee_id: null, // admin pool — awaiting assignment
          converted_client_id: client.id,
        }]);
      }
    }

    // Mint a one-time magic-link token for programmatic sign-in.
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: client.email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      throw linkErr || new Error("Could not create a sign-in token.");
    }

    return json({
      success: true,
      client_id: client.id,
      email: client.email,
      token_hash: link.properties.hashed_token,
      password_changed: client.client_password_changed,
    }, 200);
  } catch (err: any) {
    console.error("public-onboard-verify-otp error:", err?.message);
    return json({ error: "Verification failed. Please try again." }, 500);
  }
});
