// The RM notification for an unlisted-share order.
//
// Bonds grew three near-identical copies of this mail (client order, partner
// order, shared-link order) and they drifted — different field lists, one
// missing the partner attribution line. Written once here, called from all
// three share paths, so the RM always gets the same table.

import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from "./email_footer.ts";

const inr = (v: number) =>
  `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ShareOrderMailInput {
  client: {
    full_name: string;
    client_code: string;
    email: string | null;
    phone: string | null;
    employee_id: string | null;
  };
  share: { company_name: string | null; isin: string | null };
  order: { ref: string; qty: number; price_per_share: number; amount: number | null };
  /** Set when a partner raised the order on the client's behalf. */
  partnerName?: string | null;
}

/**
 * Best-effort: a failed mail must never fail an order that is already booked.
 * Callers wrap this in try/catch; it also no-ops without a Resend key so local
 * and preview environments stay quiet.
 */
export async function notifyRmOfShareOrder(
  // deno-lint-ignore no-explicit-any
  db: any,
  input: ShareOrderMailInput,
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  const { client, share, order, partnerName } = input;
  const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
  let rmEmail = adminEmail;
  let rmName = "Team";
  if (client.employee_id) {
    const { data: emp } = await db
      .from("nw_employees")
      .select("full_name, email")
      .eq("id", client.employee_id)
      .maybeSingle();
    if (emp?.email) {
      rmEmail = emp.email;
      rmName = emp.full_name || rmName;
    }
  }
  const to = [...new Set([rmEmail, adminEmail].filter(Boolean))];

  const year = new Date().getFullYear();
  const contact = [client.email, client.phone].filter(Boolean).join(" · ") || "—";
  const via = partnerName ? ` (raised by partner ${partnerName})` : "";
  const subject = `New unlisted share order ${order.ref} — ${client.full_name} (${client.client_code})`;

  const text = `Dear ${rmName},

${client.full_name} (Client Code ${client.client_code}) has placed an unlisted share order${via}.

Ref:         ${order.ref}
Company:     ${share.company_name || share.isin || "—"}
ISIN:        ${share.isin || "—"}
Quantity:    ${order.qty} share(s)
Price/share: ${inr(order.price_per_share)}
Indicative:  ${inr(order.amount ?? 0)}
Contact:     ${contact}

Open the CRM → Share Orders to review, confirm availability and send a Deal Confirmation.

Niyom Wealth Distribution LLP

${emailFooterText({ year, ref: order.ref, notice: NOTICE_AUTOMATED })}`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Dear ${escapeHtml(rmName)},</p>
    <p style="margin:0 0 14px;"><strong>${escapeHtml(client.full_name)}</strong> (Client Code <strong>${escapeHtml(client.client_code)}</strong>) has placed an unlisted share order${escapeHtml(via)}.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:130px;">Ref</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(order.ref)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Company</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(share.company_name || share.isin || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">ISIN</td><td style="padding:6px 0;">${escapeHtml(share.isin || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Quantity</td><td style="padding:6px 0;font-weight:600;">${order.qty} share(s)</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Price / share</td><td style="padding:6px 0;">${inr(order.price_per_share)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Indicative amount</td><td style="padding:6px 0;font-weight:600;">${inr(order.amount ?? 0)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Contact</td><td style="padding:6px 0;">${escapeHtml(contact)}</td></tr>
    </table>
    <p style="margin:0 0 14px;">Open the CRM → <strong>Share Orders</strong> to review, confirm availability and send a Deal Confirmation.</p>
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
