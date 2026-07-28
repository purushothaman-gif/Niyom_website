import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, json, serviceClient, NIYOM_DEFAULT_EMPLOYEE_ID,
  normalizePhone, isValidPhone, isValidEmail, isValidPan,
  generateOTP, persistOtp, deliverOtp, isRateLimited, maskEmail,
} from "../_shared/onboarding.ts";

// Step 1 of the conversion-first onboarding. Creates a usable client account
// from just Full Name + Mobile + Email, provisions a Supabase auth user, and
// sends a mobile OTP. Public (verify_jwt = false); uses the service role.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const full_name = (body.full_name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const phone = normalizePhone(body.phone || "");
    // PAN was verified (name-as-per-PAN fetched) at the first step by
    // public-onboard-pan-verify; the client's name comes from that verify.
    const pan = (body.pan || "").trim().toUpperCase();

    if (!full_name) return json({ error: "Please enter your full name." }, 400);
    if (!isValidPan(pan)) return json({ error: "Please verify your PAN first." }, 400);
    if (!isValidPhone(phone)) return json({ error: "Enter a valid 10-digit mobile number." }, 400);
    if (!isValidEmail(email)) return json({ error: "Enter a valid email address." }, 400);

    const db = serviceClient();

    // If an account already exists for this mobile/email, don't create a second
    // one — send them down the "continue your application" (OTP login) path.
    // Two separate equality queries avoid interpolating email into an .or()
    // filter (an email may legally contain a comma).
    const [{ data: byPhone }, { data: byEmail }] = await Promise.all([
      db.from("nw_clients").select("id").eq("phone", phone).maybeSingle(),
      db.from("nw_clients").select("id").eq("email", email).maybeSingle(),
    ]);
    const existing = byPhone || byEmail;

    if (existing) {
      // Still send an OTP so the client can sign in and resume.
      if (!(await isRateLimited(db, phone))) {
        const code = generateOTP();
        await persistOtp(db, phone, code);
        await deliverOtp(phone, email, code);
      }
      return json({
        already_exists: true,
        email_masked: maskEmail(email),
        message: "An account already exists for these details. We've emailed a code to sign you in.",
      }, 200);
    }

    // Marketing Tool referral attribution (optional).
    //
    // A signup arriving through an employee's referral link is owned by THAT
    // employee instead of the NIYOM-001 house account. Resolution is entirely
    // best-effort: no ref, an unknown ref, a deactivated link or any error at
    // all leaves ownerEmployeeId at the default, which is byte-for-byte the
    // behaviour this function had before referrals existed.
    let ownerEmployeeId = NIYOM_DEFAULT_EMPLOYEE_ID;
    let refCode: string | null = null;

    if (typeof body.ref === "string" && body.ref.trim()) {
      const candidate = body.ref.trim().slice(0, 64);
      try {
        const { data: link } = await db
          .from("mkt_referral_links")
          .select("employee_id")
          .eq("ref_code", candidate)
          .eq("active", true)
          .maybeSingle();

        if (link?.employee_id) {
          ownerEmployeeId = link.employee_id;
          refCode = candidate;
        }
      } catch (refErr) {
        console.error("referral resolution failed, using default owner:", refErr);
      }
    }

    // Generate the client code under the owning employee.
    const { data: clientCode, error: codeErr } = await db.rpc("nw2_generate_client_code", {
      p_employee_id: ownerEmployeeId,
    });
    if (codeErr) throw codeErr;

    // Create the client row (minimal — KYC fields fill in progressively).
    const { data: client, error: clientErr } = await db.from("nw_clients").insert([{
      client_code: clientCode,
      employee_id: ownerEmployeeId,
      full_name,
      email,
      phone,
      // PAN captured + verified up front (Cashfree, via public-onboard-pan-verify),
      // so the in-portal KYC wizard skips its PAN step. onboarding_status stays
      // "account_created" so verify-otp's first-OTP funnel/website-lead logic fires.
      pan,
      pan_name: full_name,
      pan_verified: true,
      verification_status: "pending",
      onboarding_status: "account_created",
      sourced_via: "direct",
      client_login_enabled: true,
      client_password_changed: true, // no password step in this flow (OTP login)
    }]).select("id").single();
    if (clientErr) throw clientErr;

    // Provision / link a Supabase auth user for the client (reuses the
    // create-client-login approach: reuse an existing auth user by email, else
    // create one). Sign-in happens later via a magic-link token after OTP.
    const randomPw = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    let authUserId: string | null = null;

    const { data: listed } = await db.auth.admin.listUsers();
    const existingUser = listed?.users?.find((u) => u.email?.toLowerCase() === email);

    if (existingUser) {
      await db.auth.admin.updateUserById(existingUser.id, {
        email_confirm: true,
        user_metadata: { ...existingUser.user_metadata, client_id: client.id, is_client: true, phone },
      });
      authUserId = existingUser.id;
    } else {
      const { data: created, error: createErr } = await db.auth.admin.createUser({
        email,
        password: randomPw,
        email_confirm: true,
        user_metadata: { client_id: client.id, is_client: true, phone },
      });
      if (createErr) throw createErr;
      authUserId = created.user.id;
    }

    await db.from("nw_clients")
      .update({ client_auth_user_id: authUserId })
      .eq("id", client.id);

    // Send the OTP (SMS + email).
    const code = generateOTP();
    await persistOtp(db, phone, code);
    await deliverOtp(phone, email, code);

    // Record the attribution so verify-otp can assign the resulting lead and so
    // the marketing analytics can join click -> lead -> client. Best-effort:
    // a failure here must not cost the client their account.
    if (refCode) {
      try {
        await db.from("mkt_lead_attributions").insert([{
          client_id: client.id,
          employee_id: ownerEmployeeId,
          ref_code: refCode,
          content_no: typeof body.cnt === "string" ? body.cnt.slice(0, 32) : null,
          platform: typeof body.pl === "string" ? body.pl.slice(0, 32) : "",
        }]);
      } catch (attrErr) {
        console.error("attribution insert failed (client already created):", attrErr);
      }
    }

    // Activity log for the RM (mirrors public-client-onboard).
    await db.from("nw_activity_logs").insert([{
      employee_id: ownerEmployeeId,
      client_id: client.id,
      action: "Client Self-Registered (Free Account)",
      description: `${full_name} created a free account (${clientCode}) via the public portal.`
        + `${refCode ? ` Referred by this employee's link (${refCode}).` : ""}`
        + ` Mobile OTP sent; KYC pending.`,
    }]);

    return json({
      success: true,
      client_id: client.id,
      client_code: clientCode,
      email_masked: maskEmail(email),
    }, 200);
  } catch (err: any) {
    console.error("public-onboard-start error:", err?.message);
    return json({ error: err?.message || "An unexpected error occurred." }, 500);
  }
});
