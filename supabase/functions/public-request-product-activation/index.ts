import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from "../_shared/email_footer.ts";

// Product activation — an already-active client asks to enable Bonds and/or
// Unlisted Shares (the products that need a demat + CML). The client has
// uploaded their CML via public-onboard-record-doc first; this function adds the
// products to investment_preferences, marks CML required, stores the demat
// details and notifies the assigned RM. Runs with the service role but requires
// the client's session + ownership of the record.
//
// Only these two products can be activated here — the rest (Mutual Funds, FD,
// Insurance) never require a demat/CML and are available from onboarding.
const ACTIVATABLE = new Set(["bonds", "unlisted_shares"]);

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
    const requested: string[] = Array.isArray(body.products)
      ? [...new Set(body.products.filter((p: string) => ACTIVATABLE.has(p)))]
      : [];
    const demat_account = (body.demat_account || "").trim();
    const dp_name = (body.dp_name || "").trim();

    if (!client_id) return json({ error: "Missing client." }, 400);
    if (requested.length === 0) return json({ error: "Select at least one product to activate (Bonds or Unlisted Shares)." }, 400);
    if (!demat_account || !dp_name) return json({ error: "Demat account (BO ID) and DP name are required." }, 400);

    const db = serviceClient();
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, employee_id, onboarding_status, cml_uploaded, investment_preferences, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);
    // Activation is only for clients whose account is already live.
    if (client.onboarding_status !== "active") {
      return json({ error: "Finish your KYC first — product activation is available once your account is active." }, 400);
    }
    // The CML must be on file before we enable Bonds / Unlisted Shares.
    if (!client.cml_uploaded) {
      return json({ error: "Please upload your Demat proof (CML) before activating these products." }, 400);
    }

    // Union the requested products onto whatever the client already has.
    const existing: string[] = Array.isArray(client.investment_preferences) ? client.investment_preferences : [];
    const merged = [...new Set([...existing, ...requested])];
    const depository = demat_account.toUpperCase().startsWith("IN") ? "NSDL" : "CDSL";

    const { error: updErr } = await db.from("nw_clients").update({
      investment_preferences: merged,
      cml_required: true,
      demat_account,
      dp_name,
      depository,
    }).eq("id", client_id);
    if (updErr) throw updErr;

    const newlyAdded = requested.filter((p) => !existing.includes(p));

    await db.from("nw_activity_logs").insert([{
      employee_id: client.employee_id,
      client_id,
      action: "Product Activation Requested",
      description: `${client.full_name} (${client.client_code}) requested ${requested.map((p) => PREF_LABELS[p]).join(" & ")} — demat + CML provided.`,
    }]);

    // Notify the assigned RM (best-effort — never blocks the request).
    try {
      await notifyRm(db, client, requested);
    } catch (e) {
      console.error("RM notification failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, investment_preferences: merged, newly_added: newlyAdded }, 200);
  } catch (err: any) {
    console.error("public-request-product-activation error:", err?.message);
    return json({ error: err?.message || "Could not activate products. Please try again." }, 500);
  }
});

async function notifyRm(
  db: ReturnType<typeof serviceClient>,
  client: { full_name: string; client_code: string; employee_id: string | null },
  products: string[],
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
  const productList = products.map((p) => PREF_LABELS[p]).join(" & ");
  const subject = `Product activation requested — ${client.full_name} (${client.client_code})`;
  const text = `Dear ${rmName},

${client.full_name} (Client Code ${client.client_code}) has requested to activate ${productList}.

They have provided their demat account (BO ID) and uploaded a Demat proof (CML). Please review the details in the CRM and verify the demat proof before raising any Deal Confirmation.

Niyom Wealth Distribution LLP

${emailFooterText({ year, ref: client.client_code, notice: NOTICE_AUTOMATED })}`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Dear ${rmName},</p>
    <p style="margin:0 0 14px;"><strong>${client.full_name}</strong> (Client Code <strong>${client.client_code}</strong>) has requested to activate <strong>${productList}</strong>.</p>
    <p style="margin:0 0 14px;">They have provided their demat account (BO ID) and uploaded a Demat proof (CML). Please review the details in the CRM and verify the demat proof before raising any Deal Confirmation.</p>
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
