/**
 * partner-submit-lead — a signed-in partner (DSA) refers a prospect directly
 * from the Partner Portal. The lead lands in the CRM owned by the partner's own
 * relationship manager, tagged with the partner's dsa_id.
 *
 * verify_jwt = false, but the caller is fully authenticated inside: we require a
 * bearer token, resolve the auth user, and then RE-READ nw_dsa to confirm they
 * are an enabled, active partner. user_metadata.is_partner alone is never
 * trusted — metadata is not authoritative, and an RM disabling a login must take
 * effect immediately rather than when the JWT expires.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Same house account the public onboarding flow falls back to. nw_dsa.employee_id
// is nullable in production, and nw_leads.owner_employee_id NULL means "admin
// pool" — acceptable, but an explicit owner gets the lead worked sooner.
const NIYOM_DEFAULT_EMPLOYEE_ID = "1b543112-3251-4912-847b-92982f2de563";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Authenticate the partner ------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Authoritative check against the table, not the JWT metadata.
    const { data: dsa } = await db
      .from("nw_dsa")
      .select("id, dsa_code, full_name, employee_id, status, dsa_login_enabled")
      .eq("dsa_auth_user_id", user.id)
      .eq("dsa_login_enabled", true)
      .eq("status", "active")
      .maybeSingle();

    if (!dsa) return json({ error: "Partner access required" }, 403);

    // --- Validate input ----------------------------------------------------
    const body = await req.json().catch(() => ({}));
    const fullName = String(body.full_name ?? "").trim().slice(0, 120);
    const mobile = String(body.mobile ?? "").replace(/\D/g, "").slice(0, 15);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 160);
    const city = String(body.city ?? "").trim().slice(0, 80);
    const product = String(body.interested_product ?? "").trim().slice(0, 80);
    const remarks = String(body.remarks ?? "").trim().slice(0, 500);

    if (fullName.length < 2) return json({ error: "Please enter the prospect's name." }, 400);
    if (mobile.length !== 10) return json({ error: "Please enter a valid 10-digit mobile number." }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }

    // --- Duplicate guard ----------------------------------------------------
    // Mobile is the practical identity for a lead. Report duplicates plainly so
    // the partner knows the prospect is already in the system rather than
    // silently creating a second record for the RM to de-dupe later.
    const { data: existing } = await db
      .from("nw_leads")
      .select("id, dsa_id")
      .eq("mobile", mobile)
      .eq("is_archived", false)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return json({
        error: existing.dsa_id === dsa.id
          ? "You have already submitted this mobile number."
          : "This mobile number is already in our system. Please contact your relationship manager.",
        code: "duplicate",
      }, 409);
    }

    // --- Create the lead ----------------------------------------------------
    const { data: lead, error: leadErr } = await db.from("nw_leads").insert([{
      lead_name: fullName,
      mobile,
      email,
      city,
      interested_product: product,
      remarks,
      lead_origin: "partner_portal",
      lead_source: "Partner / DSA",
      campaign: `partner:${dsa.dsa_code}`,
      status: "New",
      // Worked by the partner's own RM; house account only if the DSA has none.
      owner_employee_id: dsa.employee_id ?? NIYOM_DEFAULT_EMPLOYEE_ID,
      // NULL, not the RM: no employee created this record.
      created_by_employee_id: null,
      dsa_id: dsa.id,
    }]).select("id, lead_code").single();

    if (leadErr) {
      console.error("partner-submit-lead insert failed:", leadErr.message);
      return json({ error: "Could not submit this lead. Please try again." }, 500);
    }

    // Activity log for the RM. Best-effort — the lead already exists.
    try {
      await db.from("nw_activity_logs").insert([{
        employee_id: dsa.employee_id ?? NIYOM_DEFAULT_EMPLOYEE_ID,
        action: "Lead Submitted by Partner",
        description:
          `${dsa.full_name} (${dsa.dsa_code}) submitted ${fullName} (${mobile}) ` +
          `via the Partner Portal. Lead ${lead.lead_code}.`,
      }]);
    } catch (logErr) {
      console.error("activity log failed (lead already created):", logErr);
    }

    return json({ success: true, lead_id: lead.id, lead_code: lead.lead_code }, 200);
  } catch (err) {
    console.error("partner-submit-lead error:", (err as Error)?.message);
    return json({ error: "Internal server error" }, 500);
  }
});
