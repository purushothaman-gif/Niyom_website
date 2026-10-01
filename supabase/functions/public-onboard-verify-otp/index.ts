import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, json, serviceClient,
  normalizePhone, isValidPhone, isValidEmail, checkOtp,
} from "../_shared/onboarding.ts";
import { clientAuthEmail } from "../_shared/clientAuth.ts";

// Verifies an email OTP and returns a magic-link token the client exchanges for
// a live Supabase session (no password on the wire). Serves both first-time
// verification (Step 1, keyed by phone) and return-login (keyed by email). The
// OTP itself is always stored against the client's phone in nw_otps. Public
// (verify_jwt = false).

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

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
      .from("nw_clients")
      .select("id, full_name, email, phone, client_auth_user_id, onboarding_status, phone_verified, client_password_changed")
      .eq("client_login_enabled", true);
    // limit(2), not maybeSingle(): related clients may share one mobile/email.
    // An ambiguous match is refused rather than signed in as either of them.
    const { data: found } = await (byEmail
      ? lookup.eq("email", email)
      : lookup.eq("phone", phoneIn)).limit(2);
    if (found && found.length > 1) {
      return json({ error: "This email is linked to more than one account. Please sign in with your PAN and password." }, 409);
    }
    const client = found?.[0] ?? null;

    if (!client || !client.email || !client.phone) {
      return json({ error: "No account found for these details." }, 404);
    }

    const phone = normalizePhone(client.phone);
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
        // Marketing Tool referral: if this signup came through an employee's
        // referral link, the lead belongs to that employee rather than the
        // admin pool. Wrapped so any failure falls through to the original
        // unattributed insert — an attribution problem must never cost us a
        // lead record.
        let attribution: {
          id: string;
          employee_id: string;
          content_no: string | null;
          dsa_id: string | null;
        } | null = null;
        try {
          const { data } = await db
            .from("mkt_lead_attributions")
            .select("id, employee_id, content_no, dsa_id")
            .eq("client_id", client.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          attribution = data ?? null;
        } catch (attrErr) {
          console.error("attribution lookup failed; lead goes to admin pool:", attrErr);
        }

        const { data: lead } = await db.from("nw_leads").insert([{
          lead_name: client.full_name || "Website Signup",
          mobile: phone,
          email: client.email,
          lead_origin: "website_signup",
          // A partner-referred signup is labelled as such, matching the
          // 'Partner / DSA' entry that already exists in LEAD_SOURCES.
          lead_source: attribution?.dsa_id
            ? "Partner / DSA"
            : attribution
              ? "Referral"
              : "Website Sign-up",
          campaign: attribution
            ? (attribution.content_no ? `mkt:${attribution.content_no}` : "mkt:referral")
            : "",
          status: "New",
          // Attributed -> the referring employee owns it; otherwise the admin
          // pool, exactly as before.
          owner_employee_id: attribution?.employee_id ?? null,
          // Provenance, so the CRM (and the partner's own My Leads view) can
          // see which partner introduced this person.
          dsa_id: attribution?.dsa_id ?? null,
          converted_client_id: client.id,
        }]).select("id").single();

        if (attribution && lead?.id) {
          try {
            await db.from("mkt_lead_attributions")
              .update({ lead_id: lead.id })
              .eq("id", attribution.id);
          } catch (linkErr2) {
            console.error("could not link attribution to lead:", linkErr2);
          }
        }
      }
    }

    // Mint a one-time magic-link token for programmatic sign-in.
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      // The auth user's own email — not always the record's (shared addresses).
      email: (await clientAuthEmail(db, client)) ?? client.email,
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
