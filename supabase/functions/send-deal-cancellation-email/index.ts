import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailFooterHtml, emailFooterText } from "../_shared/email_footer.ts";
import { asJson } from '../_shared/json.ts';

// Cancels an unpaid Deal Confirmation and emails the client a cancellation
// notice. Triggered manually from the CRM by the owning employee or an admin.
//
// The state change is done by the nw_cancel_deal() RPC, called AS THE CALLER so
// the database enforces every rule (ownership, 24h since the mail, no payment,
// not booked). This function only adds the email + audit trail around it.
//
// Calling it again on an already-cancelled deal re-sends the notice — that is
// the retry path when the first email failed after the deal was cancelled.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const isValidEmail = (e: unknown): e is string =>
  typeof e === "string" && /^\S+@\S+\.\S+$/.test(e.trim());

const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inr = (n: unknown) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";

// Client-facing job title — use display-only `designation`, never the internal `role`.
function formatDesignation(designation: string | null | undefined): string {
  return (designation && designation.trim()) || "Relationship Manager";
}

function buildCc(candidates: (string | null | undefined)[], to: string): string[] {
  const seen = new Set<string>([to.trim().toLowerCase()]);
  const cc: string[] = [];
  for (const c of candidates) {
    if (!isValidEmail(c)) continue;
    const norm = c.trim().toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    cc.push(norm);
  }
  return cc;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const db = createClient(supabaseUrl, serviceKey);

    const { data: employee } = await db
      .from("nw_employees")
      .select("id, full_name, role, designation, email, phone")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!employee) return json({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const dealId = typeof body?.dealId === "string" ? body.dealId : null;
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!dealId) return json({ success: false, error: "Missing dealId." }, 400);

    // Check the address BEFORE cancelling, so a deal is never cancelled with no
    // way to tell the client. (RLS scopes this read to the caller's own deals.)
    const { data: pre } = await callerClient
      .from("nw_deal_confirmations")
      .select("snap_email")
      .eq("id", dealId)
      .maybeSingle();
    if (!pre) return json({ success: false, error: "Deal not found." }, 404);
    if (!isValidEmail(pre.snap_email)) {
      return json({ success: false, error: "No valid client email is on record for this deal." }, 400);
    }

    // --- Cancel (rules enforced in the database, as the caller) ---
    const { data: cancelRes, error: cancelErr } = await callerClient.rpc("nw_cancel_deal", {
      p_deal_id: dealId,
      p_reason: reason || undefined,
    });
    if (cancelErr) return json({ success: false, error: cancelErr.message }, 409);
    const alreadyCancelled = !!(cancelRes as { already_cancelled?: boolean } | null)?.already_cancelled;

    // --- Load the cancelled deal + its lines for the notice ---
    const { data: deal } = await db
      .from("nw_deal_confirmations")
      .select("id, confirmation_number, deal_date, snap_client_name, snap_email, employee_id, settlement_amount, email_sent_at, cancellation_reason")
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return json({ success: false, error: "Deal not found." }, 404);

    const { data: items } = await db
      .from("nw_deal_confirmation_items")
      .select("sort_order, security_name, isin, quantity, base_rate, line_settlement")
      .eq("deal_id", dealId)
      .order("sort_order", { ascending: true });
    const lines = items ?? [];

    const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
    let ownerEmail: string | null = null;
    if (deal.employee_id) {
      const { data: owner } = await db.from("nw_employees")
        .select("email").eq("id", deal.employee_id).maybeSingle();
      ownerEmail = owner?.email ?? null;
    }
    const clientTo = deal.snap_email.trim();
    const cc = buildCc([ownerEmail, employee.email, adminEmail], clientTo);

    const noteReason = (deal.cancellation_reason || "").trim();
    const designation = formatDesignation(employee.designation);
    const year = new Date().getFullYear();
    const ref = deal.confirmation_number;
    const subject = `Deal Confirmation Cancelled – Ref ${ref}`;

    const text = `Dear ${deal.snap_client_name},

This is to inform you that Deal Confirmation Note Ref ${ref} dated ${fmtDate(deal.deal_date)} has been cancelled, as the payment was not received within 24 hours of the confirmation being shared with you.

Cancelled deal:
${lines.map((l) => `- ${l.security_name} (${l.isin}) — Qty ${Number(l.quantity).toLocaleString("en-IN")} @ ${inr(l.base_rate)} = ${inr(l.line_settlement)}`).join("\n")}
Total: ${inr(deal.settlement_amount)}
${noteReason ? `\nNote: ${noteReason}\n` : ""}
The confirmation link sent earlier is no longer valid and no payment should be made against this note. If you have already remitted the amount, please reply to this email with the payment reference so that we can assist you right away.

Should you still wish to proceed, I would be glad to share a fresh confirmation at the prevailing price, subject to availability.

Warm regards,

${employee.full_name}
${designation} | Niyom Wealth Distribution LLP
M: ${employee.phone}   E: ${employee.email}

${emailFooterText({ year, ref })}`;

    const th = 'style="padding:8px 10px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #ddd;"';
    const td = 'style="padding:8px 10px;font-size:13px;color:#111;border-bottom:1px solid #eee;"';
    const tdR = 'style="padding:8px 10px;font-size:13px;color:#111;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;"';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f6f6f6;">
    Deal Confirmation ${escapeHtml(ref)} has been cancelled as payment was not received.
  </div>
  <div style="max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">
    <div style="border-bottom:2px solid #D4AF37;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#111;">Niyom Wealth</div>
    </div>
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${escapeHtml(deal.snap_client_name)},</p>
    <p style="margin:0 0 14px;">This is to inform you that Deal Confirmation Note <strong>Ref ${escapeHtml(ref)}</strong> dated ${fmtDate(deal.deal_date)} has been <strong>cancelled</strong>, as the payment was not received within 24 hours of the confirmation being shared with you.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:18px 0;border:1px solid #eee;">
      <tr><th ${th}>Security</th><th ${th}>Qty</th><th ${th}>Rate</th><th ${th.replace("text-align:left", "text-align:right")}>Amount</th></tr>
      ${lines.map((l) => `<tr>
        <td ${td}>${escapeHtml(l.security_name)}<br/><span style="font-size:11px;color:#777;">${escapeHtml(l.isin)}</span></td>
        <td ${td}>${Number(l.quantity).toLocaleString("en-IN")}</td>
        <td ${td}>${inr(l.base_rate)}</td>
        <td ${tdR}>${inr(l.line_settlement)}</td>
      </tr>`).join("")}
      <tr><td colspan="3" style="padding:10px;font-size:13px;font-weight:700;color:#111;">Total</td>
          <td style="padding:10px;font-size:13px;font-weight:700;color:#111;text-align:right;white-space:nowrap;">${inr(deal.settlement_amount)}</td></tr>
    </table>
    ${noteReason ? `<p style="margin:0 0 14px;"><strong>Note:</strong> ${escapeHtml(noteReason)}</p>` : ""}
    <p style="margin:0 0 14px;">The confirmation link sent earlier is no longer valid and no payment should be made against this note. If you have already remitted the amount, please reply to this email with the payment reference so that we can assist you right away.</p>
    <p style="margin:0 0 14px;">Should you still wish to proceed, I would be glad to share a fresh confirmation at the prevailing price, subject to availability.</p>
    <p style="margin:18px 0 6px;">Warm regards,</p>
    <div>
      <div style="font-weight:700;color:#111;">${escapeHtml(employee.full_name)}</div>
      <div style="color:#555;font-size:13px;line-height:1.7;">
        ${escapeHtml(designation)} &nbsp;|&nbsp; Niyom Wealth Distribution LLP<br/>
        M: ${escapeHtml(employee.phone)} &nbsp; E: <a href="mailto:${escapeHtml(employee.email)}" style="color:#B8961E;">${escapeHtml(employee.email)}</a>
      </div>
    </div>
    ${emailFooterHtml({ year, ref })}
  </div>
</body></html>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Niyom Wealth <support@niyomwealth.com>",
        to: [clientTo],
        ...(cc.length ? { cc } : {}),
        subject, text, html,
      }),
    });
    const resendData = await resendResponse.json().catch(() => ({}));

    // Append-only email audit row (best-effort).
    try {
      await db.from("nw_deal_email_log").insert({
        deal_confirmation_id: deal.id, email_type: "deal_cancellation",
        sent_to: clientTo, cc_recipients: cc, sent_by: employee.id,
        is_resend: alreadyCancelled,
        status: resendResponse.ok ? "sent" : "failed",
        provider_message_id: resendResponse.ok ? (resendData?.id ?? null) : null,
        metadata: asJson({
          subject, reason: noteReason || null,
          ...(resendResponse.ok ? {} : { error: resendData?.message ?? "send failed" }),
        }),
      });
    } catch (logErr) {
      console.error("email-log insert failed:", logErr);
    }

    if (!resendResponse.ok) {
      console.error("Resend API error (deal_cancellation):", resendData);
      // The deal IS cancelled at this point; only the notice failed.
      return json({
        success: false, cancelled: true,
        error: `The deal was cancelled, but the email could not be sent (${resendData?.message || "send failed"}). Use "Resend cancellation mail" to retry.`,
      }, 502);
    }

    await db.from("nw_deal_confirmation_events").insert({
      deal_id: deal.id, event_type: "cancellation_emailed", actor: "employee",
      metadata: { emailId: resendData.id, to: clientTo, cc, resend: alreadyCancelled, sent_by: employee.id },
    });

    return json({ success: true, cancelled: true, resend: alreadyCancelled, emailId: resendData.id });
  } catch (err: any) {
    console.error("send-deal-cancellation-email error:", err?.message);
    return json({ success: false, error: err?.message || "Internal server error." }, 500);
  }
});
