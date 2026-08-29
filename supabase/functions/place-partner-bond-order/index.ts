import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from "../_shared/email_footer.ts";

// place-partner-bond-order — a logged-in PARTNER (DSA) places a bond order on
// behalf of one of their own clients, at the partner's per-bond price. Runs public
// (verify_jwt=false) but requires the partner's own bearer + is_partner, resolves
// the DSA from the auth user, and verifies the chosen client belongs to that DSA.
// The PRICE IS RE-DERIVED HERE (cost = latest × approved partner rate, then × the
// per-bond margin, capped 5%) — never trusted from the client. Inserts the order
// (source='partner', dsa_id set), routed to the client's RM (fires the alert), and
// emails the RM.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user || user.user_metadata?.is_partner !== true) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const client_id = String(body.client_id || "").trim();
    const bond_id = String(body.bond_id || "").trim();
    const units = Number.parseInt(String(body.units ?? ""), 10);
    const margin = Number(body.margin ?? 0);
    const notes = String(body.notes || "").trim().slice(0, 1000);

    if (!client_id) return json({ error: "Choose a client." }, 400);
    if (!bond_id) return json({ error: "Missing bond." }, 400);
    if (!Number.isInteger(units) || units <= 0) return json({ error: "Enter a valid quantity." }, 400);
    if (!Number.isFinite(margin) || margin < 0 || margin > 5) return json({ error: "Your margin must be between 0% and 5%." }, 400);

    const db = serviceClient();

    // Resolve the DSA from the bearer (must be an enabled, active partner login).
    const { data: dsa } = await db
      .from("nw_dsa")
      .select("id, full_name, email, employee_id, status, dsa_login_enabled")
      .eq("dsa_auth_user_id", user.id)
      .maybeSingle();
    if (!dsa || !dsa.dsa_login_enabled || dsa.status !== "active") return json({ error: "Unauthorized" }, 403);

    // The client must belong to this DSA.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, email, phone, employee_id, dsa_id, sourced_via")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.dsa_id !== dsa.id || client.sourced_via !== "dsa") {
      return json({ error: "That client isn't mapped to you." }, 403);
    }

    // Bond must be active and priced.
    const { data: bond } = await db
      .from("bm_bonds")
      .select("id, isin, bond_name, latest_price, face_value, min_investment, lot_size, active_status, verification_status, analytics")
      .eq("id", bond_id)
      .maybeSingle();
    if (!bond || bond.active_status !== "active" || bond.verification_status !== "verified" || bond.latest_price == null) {
      return json({ error: "This bond is not available." }, 404);
    }

    // Re-derive the partner cost (approved partner rate only), then apply the per-bond margin.
    const { data: rate, error: rErr } = await db.rpc("bm_resolve_markup", {
      p_audience: "partner",
      p_client_id: null as unknown as string,
      p_dsa_id: dsa.id,
      p_employee_id: (dsa.employee_id ?? null) as unknown as string,
    });
    if (rErr) throw rErr;
    if (rate == null) return json({ error: "Bond pricing isn't approved for you yet." }, 403);

    const costPer100 = Number(bond.latest_price) * (1 + Number(rate) / 100);
    const pricePer100 = round4(costPer100 * (1 + margin / 100));

    // Enforce the min/lot rule.
    const face = Number(bond.face_value) || 100;
    const minUnits = Math.max(1, Math.ceil((Number(bond.min_investment) || face) / face));
    const stepUnits = Math.max(1, Math.round(Number(bond.lot_size) || 1));
    if (units < minUnits || (units - minUnits) % stepUnits !== 0) {
      return json({ error: `Quantity must be ${minUnits} or more, in steps of ${stepUnits}.` }, 400);
    }

    const analytics = (bond.analytics ?? {}) as Record<string, unknown>;
    const accruedPer100 = Number(analytics.accrued_per_100) || 0;
    const principal = round2(units * face * (pricePer100 / 100));
    const accrued = round2(units * face * (accruedPer100 / 100));
    const amount = round2(principal + accrued);

    const { data: order, error: insErr } = await db
      .from("nw_bond_orders")
      .insert({
        client_id,
        bond_id,
        assigned_employee_id: client.employee_id,
        dsa_id: dsa.id,
        source: "partner",
        partner_markup_percent: margin,
        isin: bond.isin || "",
        bond_name: bond.bond_name || "",
        units,
        price_per_100: pricePer100,
        face_value: face,
        amount,
        notes,
      })
      .select("id, ref, units, price_per_100, amount, status, created_at")
      .single();
    if (insErr) throw insErr;

    try {
      await notifyRm(db, client, dsa, bond, order, { accrued, margin });
    } catch (e) {
      console.error("RM partner-order email failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, order }, 200);
  } catch (err: any) {
    console.error("place-partner-bond-order error:", err?.message);
    return json({ error: err?.message || "Could not place the order. Please try again." }, 500);
  }
});

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n: number): number { return Math.round((n + Number.EPSILON) * 10000) / 10000; }
const inr = (v: number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function notifyRm(
  db: ReturnType<typeof serviceClient>,
  client: { full_name: string; client_code: string; email: string | null; phone: string | null; employee_id: string | null },
  dsa: { full_name: string | null },
  bond: { bond_name: string | null; isin: string | null },
  order: { ref: string; units: number; price_per_100: number; amount: number | null },
  extra: { accrued: number; margin: number },
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
  let rmEmail = adminEmail;
  let rmName = "Team";
  if (client.employee_id) {
    const { data: emp } = await db.from("nw_employees").select("full_name, email").eq("id", client.employee_id).maybeSingle();
    if (emp?.email) { rmEmail = emp.email; rmName = emp.full_name || rmName; }
  }
  const to = [...new Set([rmEmail, adminEmail].filter(Boolean))];
  const year = new Date().getFullYear();
  const partnerName = dsa.full_name || "a partner";
  const subject = `New bond order ${order.ref} — ${client.full_name} (via ${partnerName})`;

  const text = `Dear ${rmName},

${partnerName} (partner) has placed a bond order for ${client.full_name} (Client Code ${client.client_code}).

Ref:        ${order.ref}
Bond:       ${bond.bond_name || bond.isin || "—"}
ISIN:       ${bond.isin || "—"}
Quantity:   ${order.units} unit(s)
Price/₹100: ${inr(order.price_per_100)} (incl. partner margin ${extra.margin}%)
Accrued:    ${inr(extra.accrued)}
Indicative: ${inr(order.amount ?? 0)}

Open the CRM → Bond Orders to review, adjust the value, and send a Deal Confirmation.

Niyom Wealth Distribution LLP

${emailFooterText({ year, ref: order.ref, notice: NOTICE_AUTOMATED })}`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Dear ${rmName},</p>
    <p style="margin:0 0 14px;"><strong>${escapeHtml(partnerName)}</strong> (partner) has placed a bond order for <strong>${escapeHtml(client.full_name)}</strong> (Client Code <strong>${escapeHtml(client.client_code)}</strong>).</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:130px;">Ref</td><td style="padding:6px 0;font-weight:600;">${order.ref}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Bond</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(bond.bond_name || bond.isin || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Quantity</td><td style="padding:6px 0;font-weight:600;">${order.units} unit(s)</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Price / ₹100</td><td style="padding:6px 0;">${inr(order.price_per_100)} (incl. margin ${extra.margin}%)</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Indicative amount</td><td style="padding:6px 0;font-weight:600;">${inr(order.amount ?? 0)}</td></tr>
    </table>
    <p style="margin:0 0 14px;">Open the CRM → <strong>Bond Orders</strong> to review, adjust the value, and send a Deal Confirmation.</p>
    <p style="margin:18px 0 0;color:#111;font-weight:600;">Niyom Wealth Distribution LLP</p>
    ${emailFooterHtml({ year, ref: order.ref, notice: NOTICE_AUTOMATED })}
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Niyom Wealth <support@niyomwealth.com>", to, reply_to: client.email || undefined, subject, html, text }),
  });
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
