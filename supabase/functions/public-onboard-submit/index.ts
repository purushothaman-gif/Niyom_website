import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from "../_shared/email_footer.ts";

// Step 5 — client submits KYC for review. Persists investment preferences,
// derives whether a CML is required, moves the account to "KYC Under Review",
// and notifies the assigned Relationship Manager by email. Requires the
// client's session + ownership.

const VALID_PREFS = new Set([
  "mutual_funds", "bonds", "fixed_deposits", "insurance", "unlisted_shares",
]);
// Products that mandate a CML upload.
const CML_PRODUCTS = new Set(["bonds", "unlisted_shares"]);

const PREF_LABELS: Record<string, string> = {
  mutual_funds: "Mutual Funds",
  bonds: "Bonds",
  fixed_deposits: "Fixed Deposits",
  insurance: "Insurance",
  unlisted_shares: "Unlisted Shares",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user || user.user_metadata?.is_client !== true) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const client_id = (body.client_id || "").trim();
    const prefs: string[] = Array.isArray(body.investment_preferences)
      ? [...new Set(body.investment_preferences.filter((p: string) => VALID_PREFS.has(p)))]
      : [];
    if (!client_id) return json({ error: "Missing client." }, 400);
    if (prefs.length === 0) return json({ error: "Select at least one product you want to access." }, 400);

    const db = serviceClient();
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, employee_id, pan_verified, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);
    if (!client.pan_verified) return json({ error: "Please verify your PAN before submitting." }, 400);

    const cmlRequired = prefs.some((p) => CML_PRODUCTS.has(p));

    await db.from("nw_clients").update({
      investment_preferences: prefs,
      cml_required: cmlRequired,
      onboarding_status: "kyc_under_review",
      verification_status: "partial",
      kyc_submitted_at: new Date().toISOString(),
    }).eq("id", client_id);

    await db.from("nw_activity_logs").insert([{
      employee_id: client.employee_id,
      client_id,
      action: "KYC Submitted for Review",
      description: `${client.full_name} (${client.client_code}) submitted KYC. Products: ${prefs.map((p) => PREF_LABELS[p]).join(", ")}.`,
    }]);

    // Notify the assigned RM by email (best-effort — never blocks the submission).
    try {
      await notifyRm(db, client, prefs);
    } catch (e) {
      console.error("RM notification failed (non-fatal):", (e as any)?.message);
    }

    // In-app CRM alert: a self-generated (website) lead is ready for RM assignment.
    // Only fires for public-website signups (they have a website_signup lead).
    try {
      const { data: lead } = await db
        .from("nw_leads")
        .select("id")
        .eq("converted_client_id", client_id)
        .eq("lead_origin", "website_signup")
        .maybeSingle();
      if (lead) {
        await db.rpc("nw_notify_admins", {
          p_title: "Client ready to assign",
          p_message: `${client.full_name} (${client.client_code}) completed onboarding and is ready for RM assignment.`,
          p_category: "lead_ready",
          p_lead_id: lead.id,
          p_action_url: "/crm/leads",
        });
      }
    } catch (e) {
      console.error("Admin ready-to-assign alert failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, onboarding_status: "kyc_under_review" }, 200);
  } catch (err: any) {
    console.error("public-onboard-submit error:", err?.message);
    return json({ error: err?.message || "Submission failed. Please try again." }, 500);
  }
});

async function notifyRm(
  db: ReturnType<typeof serviceClient>,
  client: { full_name: string; client_code: string; employee_id: string | null },
  prefs: string[],
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  let rmEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
  let rmName = "Team";
  if (client.employee_id) {
    const { data: emp } = await db
      .from("nw_employees")
      .select("full_name, email")
      .eq("id", client.employee_id)
      .maybeSingle();
    if (emp?.email) { rmEmail = emp.email; rmName = emp.full_name || rmName; }
  }

  const year = new Date().getFullYear();
  const productList = prefs.map((p) => PREF_LABELS[p]).join(", ");
  const subject = `KYC submitted for review — ${client.full_name} (${client.client_code})`;
  const text = `Dear ${rmName},

${client.full_name} (Client Code ${client.client_code}) has submitted their KYC for review.

Products of interest: ${productList}

Please review the submitted documents and details in the CRM and approve the account to activate investing.

Niyom Wealth Distribution LLP

${emailFooterText({ year, ref: client.client_code, notice: NOTICE_AUTOMATED })}`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Dear ${rmName},</p>
    <p style="margin:0 0 14px;"><strong>${client.full_name}</strong> (Client Code <strong>${client.client_code}</strong>) has submitted their KYC for review.</p>
    <p style="margin:0 0 14px;">Products of interest: <strong>${productList}</strong></p>
    <p style="margin:0 0 14px;">Please review the submitted documents and details in the CRM and approve the account to activate investing.</p>
    <p style="margin:18px 0 0;color:#111;font-weight:600;">Niyom Wealth Distribution LLP</p>
    ${emailFooterHtml({ year, ref: client.client_code, notice: NOTICE_AUTOMATED })}
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Niyom Wealth <support@niyomwealth.com>", to: [rmEmail], subject, html, text }),
  });
}
