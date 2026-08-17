import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, json, serviceClient, NIYOM_DEFAULT_EMPLOYEE_ID,
  normalizePhone, isValidPhone, isValidEmail, isValidPan,
  generateOTP, persistOtp, deliverOtp, isRateLimited, maskEmail,
} from "../_shared/onboarding.ts";

// Partner (DSA) self-onboarding — step 1. The public analogue of the RM-driven
// create-partner-login: it creates a usable DSA account (login enabled) from
// Full Name + Mobile + Email + PAN, provisions a Supabase auth user tagged
// is_partner, and sends a mobile OTP. Ownership comes from the referral link:
// an employee's partner link maps the DSA under that RM; the company-direct link
// (no employee) maps it to the house account. Public (verify_jwt = false).
//
// Kept entirely separate from client onboarding (nw_dsa vs nw_clients, its own
// verify) so nothing in the existing client flow is touched.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const full_name = (body.full_name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const phone = normalizePhone(body.phone || "");
    const pan = (body.pan || "").trim().toUpperCase();

    if (!full_name) return json({ error: "Please enter your full name." }, 400);
    if (!isValidPan(pan)) return json({ error: "Please verify your PAN first." }, 400);
    if (!isValidPhone(phone)) return json({ error: "Enter a valid 10-digit mobile number." }, 400);
    if (!isValidEmail(email)) return json({ error: "Enter a valid email address." }, 400);

    const db = serviceClient();

    // Resume path: an account already exists for this mobile / email / PAN → just
    // send an OTP so the partner can sign in and continue, never a second row.
    const [{ data: byPhone }, { data: byEmail }, { data: byPan }] = await Promise.all([
      db.from("nw_dsa").select("id").eq("mobile", phone).maybeSingle(),
      db.from("nw_dsa").select("id").eq("email", email).maybeSingle(),
      db.from("nw_dsa").select("id").eq("pan", pan).maybeSingle(),
    ]);
    const existing = byPhone || byEmail || byPan;
    if (existing) {
      if (!(await isRateLimited(db, phone))) {
        const code = generateOTP();
        await persistOtp(db, phone, code);
        await deliverOtp(phone, email, code);
      }
      return json({
        already_exists: true,
        email_masked: maskEmail(email),
        message: "A partner account already exists for these details. We've emailed a code to sign you in.",
      }, 200);
    }

    // Separate identity: a DSA login must never reuse an existing CLIENT auth
    // user (one email = one auth user; reusing it would reset that person's
    // client-portal password). Mirrors create-partner-login's rule.
    const { data: listedForCheck } = await db.auth.admin.listUsers();
    const clash = listedForCheck?.users?.find((u: any) => u.email?.toLowerCase() === email);
    if (clash && clash.user_metadata?.is_client && !clash.user_metadata?.is_partner) {
      return json({
        error: "This email already has a client account. Please use a different email for your partner login.",
        code: "email_belongs_to_client",
      }, 409);
    }

    // Ownership from the partner referral link. No/unknown/inactive ref → the
    // company-direct/house account, exactly like the client flow's default.
    let ownerEmployeeId = NIYOM_DEFAULT_EMPLOYEE_ID;
    let refCode: string | null = null;
    let refKind: "employee" | "company" = "company";
    if (typeof body.ref === "string" && body.ref.trim()) {
      const candidate = body.ref.trim().slice(0, 64);
      try {
        const { data: link } = await db
          .from("mkt_referral_links")
          .select("employee_id, kind")
          .eq("ref_code", candidate)
          .eq("kind", "partner")
          .eq("active", true)
          .maybeSingle();
        if (link) {
          refCode = candidate;
          if (link.employee_id) { ownerEmployeeId = link.employee_id; refKind = "employee"; }
        }
      } catch (refErr) {
        console.error("partner referral resolution failed, using house account:", refErr);
      }
    }

    // Generate the DSA code under the owning employee.
    const { data: dsaCode, error: codeErr } = await db.rpc("nw2_generate_dsa_code", {
      p_employee_id: ownerEmployeeId,
    });
    if (codeErr) throw codeErr;

    // Create the DSA row (login enabled per the self-signup decision; password
    // NOT yet set so the partner is forced to set one on first portal visit).
    // The remaining KYC (bank, ARN, address) fills in progressively in the
    // portal — the other NOT NULL columns default to '' so this insert is valid.
    const { data: dsa, error: dsaErr } = await db.from("nw_dsa").insert([{
      dsa_code: dsaCode,
      employee_id: ownerEmployeeId,
      full_name,
      mobile: phone,
      email,
      pan,
      status: "active",
      dsa_login_enabled: true,
      dsa_password_changed: false,
    }]).select("id").single();
    if (dsaErr) throw dsaErr;

    // Provision / adopt a Supabase auth user tagged is_partner.
    const randomPw = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    let authUserId: string | null = null;
    const existingUser = listedForCheck?.users?.find((u: any) => u.email?.toLowerCase() === email);
    if (existingUser) {
      await db.auth.admin.updateUserById(existingUser.id, {
        email_confirm: true,
        user_metadata: { ...existingUser.user_metadata, dsa_id: dsa.id, is_partner: true, pan },
      });
      authUserId = existingUser.id;
    } else {
      const { data: created, error: createErr } = await db.auth.admin.createUser({
        email,
        password: randomPw,
        email_confirm: true,
        user_metadata: { dsa_id: dsa.id, is_partner: true, pan },
      });
      if (createErr) throw createErr;
      authUserId = created.user.id;
    }
    await db.from("nw_dsa").update({ dsa_auth_user_id: authUserId }).eq("id", dsa.id);

    // Send the mobile OTP.
    const code = generateOTP();
    await persistOtp(db, phone, code);
    await deliverOtp(phone, email, code);

    // Activity log for the owning RM.
    await db.from("nw_activity_logs").insert([{
      employee_id: ownerEmployeeId,
      action: "Partner Self-Registered",
      description: `${full_name} self-registered as a partner (${dsaCode})`
        + `${refKind === "employee" ? ` via this employee's partner link (${refCode}).` : ` via the company-direct partner link.`}`
        + ` Mobile OTP sent; password + KYC pending.`,
    }]);

    return json({ success: true, dsa_id: dsa.id, dsa_code: dsaCode, email_masked: maskEmail(email) }, 200);
  } catch (err: any) {
    console.error("public-partner-onboard-start error:", err?.message);
    return json({ error: err?.message || "An unexpected error occurred." }, 500);
  }
});
