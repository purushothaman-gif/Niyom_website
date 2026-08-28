import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from "../_shared/email_footer.ts";

// place-bond-order — a logged-in wealth-portal client places a bond order by
// quantity (units). Runs public (verify_jwt=false) but requires the client's own
// bearer token and verifies ownership server-side. The PRICE IS RE-DERIVED HERE
// (base latest_price × the client's approved markup) — a client-sent price is
// never trusted, and cost/margin never leave the server. Inserts the order with
// the service role (which fires nw_notify_rm_on_bond_order → in-app CRM alert),
// then emails the assigned RM (best-effort).

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
    const client_id = String(body.client_id || "").trim();
    const bond_id = String(body.bond_id || "").trim();
    const units = Number.parseInt(String(body.units ?? ""), 10);
    const notes = String(body.notes || "").trim().slice(0, 1000);

    if (!client_id) return json({ error: "Missing client." }, 400);
    if (!bond_id) return json({ error: "Missing bond." }, 400);
    if (!Number.isInteger(units) || units <= 0) return json({ error: "Enter a valid quantity." }, 400);

    const db = serviceClient();

    // Ownership: this bearer must own this client record.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, email, phone, employee_id, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);

    // Bond must be active and priced.
    const { data: bond } = await db
      .from("bm_bonds")
      .select("id, isin, bond_name, latest_price, face_value, min_investment, lot_size, active_status, analytics, issuer_id")
      .eq("id", bond_id)
      .maybeSingle();
    if (!bond || bond.active_status !== "active" || bond.latest_price == null) {
      return json({ error: "This bond is not available." }, 404);
    }

    // Re-derive the client price server-side (approved markup only — no default).
    const { data: markup, error: mErr } = await db.rpc("bm_resolve_markup", {
      p_audience: "client",
      p_client_id: client_id,
      p_dsa_id: null as unknown as string,
      p_employee_id: (client.employee_id ?? null) as unknown as string,
    });
    if (mErr) throw mErr;
    if (markup == null) return json({ error: "This bond is not available for your account yet." }, 403);

    const pricePer100 = round4(Number(bond.latest_price) * (1 + Number(markup) / 100));

    // Enforce the same lot rule the UI shows: start at the min-investment lot, step by lot_size.
    const face = Number(bond.face_value) || 100;
    const minUnits = Math.max(1, Math.ceil((Number(bond.min_investment) || face) / face));
    const stepUnits = Math.max(1, Math.round(Number(bond.lot_size) || 1));
    if (units < minUnits || (units - minUnits) % stepUnits !== 0) {
      return json({ error: `Quantity must be ${minUnits} or more, in steps of ${stepUnits}.` }, 400);
    }

    // Indicative amount payable = principal (dirty price) + accrued, per the analytics.
    const analytics = (bond.analytics ?? {}) as Record<string, unknown>;
    const accruedPer100 = Number(analytics.accrued_per_100) || 0;
    const principal = round2(units * face * (pricePer100 / 100));
    const accrued = round2(units * face * (accruedPer100 / 100));
    const amount = round2(principal + accrued);

    // Insert the order (fires the in-app RM alert trigger).
    const { data: order, error: insErr } = await db
      .from("nw_bond_orders")
      .insert({
        client_id,
        bond_id,
        assigned_employee_id: client.employee_id,
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

    // Email the assigned RM (best-effort — never blocks the order).
    try {
      await notifyRm(db, client, bond, order, { accrued });
    } catch (e) {
      console.error("RM bond-order email failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, order }, 200);
  } catch (err: any) {
    console.error("place-bond-order error:", err?.message);
    return json({ error: err?.message || "Could not place your order. Please try again." }, 500);
  }
});

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n: number): number { return Math.round((n + Number.EPSILON) * 10000) / 10000; }

const inr = (v: number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function notifyRm(
  db: ReturnType<typeof serviceClient>,
  client: { full_name: string; client_code: string; email: string | null; phone: string | null; employee_id: string | null },
  bond: { bond_name: string | null; isin: string | null },
  order: { ref: string; units: number; price_per_100: number; amount: number | null },
  extra: { accrued: number },
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
  let rmEmail = adminEmail;
  let rmName = "Team";
  if (client.employee_id) {
    const { data: emp } = await db
      .from("nw_employees")
      .select("full_name, email")
      .eq("id", client.employee_id)
      .maybeSingle();
    if (emp?.email) { rmEmail = emp.email; rmName = emp.full_name || rmName; }
  }
  const to = [...new Set([rmEmail, adminEmail].filter(Boolean))];

  const year = new Date().getFullYear();
  const contact = [client.email, client.phone].filter(Boolean).join(" · ") || "—";
  const subject = `New bond order ${order.ref} — ${client.full_name} (${client.client_code})`;

  const text = `Dear ${rmName},

${client.full_name} (Client Code ${client.client_code}) has placed a bond order from the wealth portal.

Ref:        ${order.ref}
Bond:       ${bond.bond_name || bond.isin || "—"}
ISIN:       ${bond.isin || "—"}
Quantity:   ${order.units} unit(s)
Price/₹100: ${inr(order.price_per_100)}
Accrued:    ${inr(extra.accrued)}
Indicative: ${inr(order.amount ?? 0)}
Contact:    ${contact}

Open the CRM → Bond Orders to review, adjust the value, and send a Deal Confirmation.

Niyom Wealth Distribution LLP

${emailFooterText({ year, ref: order.ref, notice: NOTICE_AUTOMATED })}`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Dear ${rmName},</p>
    <p style="margin:0 0 14px;"><strong>${escapeHtml(client.full_name)}</strong> (Client Code <strong>${escapeHtml(client.client_code)}</strong>) has placed a bond order from the wealth portal.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:120px;">Ref</td><td style="padding:6px 0;font-weight:600;">${order.ref}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Bond</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(bond.bond_name || bond.isin || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">ISIN</td><td style="padding:6px 0;">${escapeHtml(bond.isin || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Quantity</td><td style="padding:6px 0;font-weight:600;">${order.units} unit(s)</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Price / ₹100</td><td style="padding:6px 0;">${inr(order.price_per_100)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Indicative amount</td><td style="padding:6px 0;font-weight:600;">${inr(order.amount ?? 0)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Contact</td><td style="padding:6px 0;">${escapeHtml(contact)}</td></tr>
    </table>
    <p style="margin:0 0 14px;">Open the CRM → <strong>Bond Orders</strong> to review, adjust the value, and send a Deal Confirmation.</p>
    <p style="margin:18px 0 0;color:#111;font-weight:600;">Niyom Wealth Distribution LLP</p>
    ${emailFooterHtml({ year, ref: order.ref, notice: NOTICE_AUTOMATED })}
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Niyom Wealth <support@niyomwealth.com>",
      to,
      reply_to: client.email || undefined,
      subject,
      html,
      text,
    }),
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
