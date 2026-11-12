import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import {
  validateInvestorProfile, validateMandatePreference, validateNomination,
  type InvestorProfileInput, type MandatePreferenceInput, type NominationInput,
} from "../_shared/profile/investorProfile.ts";

// Onboarding — the investor profile a mutual-fund exchange account needs: the
// FATCA declaration (occupation, income, source of wealth, politically exposed
// status, birth and tax residency), gender, whose mobile and email these are,
// and the nomination.
//
// These columns are blocked to the client's own session by the nw_clients
// guard trigger, so this function is the only client path to them: it
// validates the whole declaration with the same rules the form uses and only
// then stores it and stamps investor_profile_completed_at.
//
// Requires the client's own bearer token and ownership of the record. It is
// for first completion and for corrections while KYC is still open; once the
// account is active AND the profile is complete, changes go through staff.
//
// Body: { client_id, profile: {...}, nomination: { choice, nominees? },
//         mandate: { preference, max_amount?, upi_id? } }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user || user.user_metadata?.is_client !== true) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const client_id = String(body.client_id ?? "").trim();
    if (!client_id) return json({ error: "Missing client." }, 400);

    const db = serviceClient();
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, employee_id, onboarding_status, investor_profile_completed_at, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);

    if (client.onboarding_status === "active" && client.investor_profile_completed_at) {
      return json({
        error: "Your investor profile is already on record. Please ask your relationship manager to change it.",
      }, 409);
    }

    const profile = validateInvestorProfile((body.profile ?? {}) as InvestorProfileInput);
    if (!profile.ok) return json({ error: profile.error }, 400);
    const nomination = validateNomination(body.nomination as NominationInput);
    if (!nomination.ok) return json({ error: nomination.error }, 400);
    const mandate = validateMandatePreference(body.mandate as MandatePreferenceInput);
    if (!mandate.ok) return json({ error: mandate.error }, 400);

    // Nominees are a full replacement. The share-total trigger is deferred, and
    // these are two statements, so a failed insert would leave no nominees —
    // put the previous rows back rather than lose them.
    const { data: before } = await db.from("nw_client_nominees").select("*").eq("client_id", client_id);
    const { error: delErr } = await db.from("nw_client_nominees").delete().eq("client_id", client_id);
    if (delErr) throw delErr;
    if (nomination.value.nominees.length > 0) {
      const { error: insErr } = await db.from("nw_client_nominees").insert(
        nomination.value.nominees.map((n) => ({
          client_id,
          full_name: n.full_name,
          relationship: n.relationship,
          dob: n.dob,
          share_percent: n.share_percent,
          guardian_name: n.guardian_name ?? null,
          guardian_dob: n.guardian_dob ?? null,
          guardian_pan: n.guardian_pan ?? null,
          guardian_relationship: n.guardian_relationship ?? null,
          id_type: n.id_type,
          id_number: n.id_number,
          added_via: "client_portal",
        })),
      );
      if (insErr) {
        if (before?.length) await db.from("nw_client_nominees").insert(before);
        throw insErr;
      }
    }

    const { error: updErr } = await db.from("nw_clients").update({
      ...profile.value,
      nomination_choice: nomination.value.choice,
      mandate_preference: mandate.value.preference,
      mandate_max_amount: mandate.value.max_amount,
      mandate_upi_id: mandate.value.upi_id,
      investor_profile_completed_at: new Date().toISOString(),
      // Declared by the client themselves, in the portal.
      investor_profile_source: "client",
      investor_profile_by: null,
    }).eq("id", client_id);
    if (updErr) throw updErr;

    await db.from("nw_activity_logs").insert([{
      employee_id: client.employee_id,
      client_id,
      action: "Investor Profile Completed",
      description: `${client.full_name} (${client.client_code}) completed the investor profile for mutual funds — `
        + (nomination.value.choice === "opt_out"
          ? "opted out of nomination."
          : `${nomination.value.nominees.length} nominee(s) added.`),
    }]);

    return json({ success: true }, 200);
  } catch (err: any) {
    console.error("public-onboard-save-profile error:", err?.message);
    return json({ error: "We could not save your profile. Please try again." }, 500);
  }
});
