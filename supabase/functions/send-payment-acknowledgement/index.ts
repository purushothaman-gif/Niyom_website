import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailFooterHtml, emailFooterText, NOTICE_RECIPIENT, NOTICE_ATTACHMENT } from "../_shared/email_footer.ts";

// Sends a Payment Acknowledgement email to the client with the appropriate
// template selected AUTOMATICALLY from the live payment status:
//
//   not_paid       -> 'payment_reminder'  (no attachment)
//   partially_paid -> 'payment_partial'   (attach the payment's receipt PDF)
//   fully_paid     -> 'payment_final'     (attach the payment's receipt PDF)
//
// Employees never pick the template. Status is derived at send time from
// nw_deal_payment_summary.
//
// Invocations:
//   { dealId }            -> reminder (only valid when status = 'not_paid')
//   { paymentId }         -> acknowledgement for a specific payment
//
// Recipients follow the Deal Confirmation pattern: To = client,
// CC = owning employee + admin. Every send inserts an append-only row into
// nw_deal_email_log carrying metadata { payment_id, receipt_version,
// payment_status_at_send } and one 'receipt_emailed' event is appended to
// nw_deal_confirmation_events.
//
// The client-side gates the button when a receipt is required but missing
// or stale; the server enforces the same guarantees so a direct API call
// cannot bypass them.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "deal-documents";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const isValidEmail = (e: unknown): e is string =>
  typeof e === "string" && /^\S+@\S+\.\S+$/.test(e.trim());

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

function inr(n: number): string {
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------
// Templates — plain-text + HTML pair per case. Mirrors the shell used
// by send-deal-confirmation-email so branding stays consistent.
// ---------------------------------------------------------------------

interface Ctx {
  clientName: string;
  // true on a Sell deal: the client is the seller, Niyom is the buyer, and the
  // money moves from us to them. Nothing may then be worded as "received".
  payout: boolean;
  confirmationNumber: string;
  dealAmount: number;
  totalPaid: number;
  outstanding: number;
  latestPaymentAmount?: number;
  receiptNumber?: string | null;
  year: number;
}

function reminderText(c: Ctx): string {
  return `Dear ${c.clientName},

This is a reminder that payment for your Deal Confirmation is still pending.

Deal Amount: ${inr(c.dealAmount)}
Amount Received: ₹0.00
Outstanding Balance: ${inr(c.outstanding)}

Please complete the payment at your earliest convenience.

If you have already made the payment, kindly ignore this email or contact your Relationship Manager.

Thank you,
Niyom Wealth Distribution LLP

${emailFooterText({ year: c.year, ref: c.confirmationNumber })}`;
}

function partialText(c: Ctx): string {
  if (c.payout) {
    return `Dear ${c.clientName},

This is to confirm that ${inr(c.latestPaymentAmount ?? 0)} has been paid to your registered bank account against your Deal Confirmation.

Deal Amount: ${inr(c.dealAmount)}
Total Amount Paid Out: ${inr(c.totalPaid)}
Balance Payable: ${inr(c.outstanding)}

The remaining balance will be released shortly.

Your updated Payment Advice is attached.

Thank you,
Niyom Wealth Distribution LLP

${emailFooterText({ year: c.year, ref: c.confirmationNumber, notice: NOTICE_ATTACHMENT })}`;
  }
  return `Dear ${c.clientName},

Thank you for your payment.

We have successfully received ${inr(c.latestPaymentAmount ?? 0)} for your Deal Confirmation.

Deal Amount: ${inr(c.dealAmount)}
Total Amount Paid: ${inr(c.totalPaid)}
Outstanding Balance: ${inr(c.outstanding)}

Please complete the remaining payment at your earliest convenience.

Your updated Payment Receipt is attached.

Thank you,
Niyom Wealth Distribution LLP

${emailFooterText({ year: c.year, ref: c.confirmationNumber, notice: NOTICE_ATTACHMENT })}`;
}

function fullText(c: Ctx): string {
  if (c.payout) {
    return `Dear ${c.clientName},

Thank you.

We confirm that the full consideration for your Deal Confirmation has been paid to your registered bank account.

Deal Amount: ${inr(c.dealAmount)}
Total Amount Paid Out: ${inr(c.totalPaid)}
Balance Payable: ₹0.00

Your official Payment Advice is attached.

Thank you for choosing Niyom Wealth Distribution LLP.

${emailFooterText({ year: c.year, ref: c.confirmationNumber, notice: NOTICE_ATTACHMENT })}`;
  }
  return `Dear ${c.clientName},

Thank you.

We confirm that the full payment for your Deal Confirmation has been successfully received.

Deal Amount: ${inr(c.dealAmount)}
Total Amount Paid: ${inr(c.totalPaid)}
Outstanding Balance: ₹0.00

Your official Payment Receipt is attached.

Thank you for choosing Niyom Wealth Distribution LLP.

${emailFooterText({ year: c.year, ref: c.confirmationNumber, notice: NOTICE_ATTACHMENT })}`;
}

function shellHtml(preheader: string, body: string, refFooter: string, year: number, includesAttachment: boolean): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f6f6f6;">
    ${preheader}
  </div>
  <div style="max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">
    <div style="border-bottom:2px solid #D4AF37;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#111;">Niyom Wealth</div>
    </div>
    ${body}
    ${emailFooterHtml({ year, ref: refFooter, notice: includesAttachment ? NOTICE_ATTACHMENT : NOTICE_RECIPIENT })}
  </div>
</body></html>`;
}

function amountRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px;color:#666;font-size:13px;">${label}</td>
    <td style="padding:6px 12px;color:#111;font-size:13px;font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}

function balanceTable(c: Ctx, showLatest: boolean): string {
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:6px;margin:14px 0;">
    <tbody>
      ${showLatest && c.latestPaymentAmount !== undefined
        ? amountRow(c.payout ? "Amount Paid" : "Amount Received", inr(c.latestPaymentAmount))
        : ""}
      ${amountRow("Deal Amount", inr(c.dealAmount))}
      ${amountRow(c.payout ? "Total Amount Paid Out" : "Total Amount Paid", inr(c.totalPaid))}
      ${amountRow(c.payout ? "Balance Payable" : "Outstanding Balance", inr(c.outstanding))}
    </tbody>
  </table>`;
}

function reminderHtml(c: Ctx): string {
  const body = `
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${c.clientName},</p>
    <p style="margin:0 0 14px;">This is a reminder that payment for your Deal Confirmation is still pending.</p>
    ${balanceTable({ ...c, totalPaid: 0 }, false)}
    <p style="margin:14px 0 0;">Please complete the payment at your earliest convenience.</p>
    <p style="margin:14px 0 0;">If you have already made the payment, kindly ignore this email or contact your Relationship Manager.</p>
    <p style="margin:18px 0 0;">Thank you,<br/><strong>Niyom Wealth Distribution LLP</strong></p>`;
  return shellHtml(
    "A payment on your Deal Confirmation is still pending.",
    body, c.confirmationNumber, c.year, false
  );
}

function partialHtml(c: Ctx): string {
  if (c.payout) {
    const body = `
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${c.clientName},</p>
    <p style="margin:0 0 14px;">This is to confirm that <strong>${inr(c.latestPaymentAmount ?? 0)}</strong> has been paid to your registered bank account against your Deal Confirmation.</p>
    ${balanceTable(c, false)}
    <p style="margin:14px 0 0;">The remaining balance will be released shortly.</p>
    <p style="margin:14px 0 0;">Your updated Payment Advice is attached${c.receiptNumber ? ` (<span style="font-family:monospace">${c.receiptNumber}</span>)` : ""}.</p>
    <p style="margin:18px 0 0;">Thank you,<br/><strong>Niyom Wealth Distribution LLP</strong></p>`;
    return shellHtml(
      "Payment made to your account. Balance payable updated. Advice attached.",
      body, c.confirmationNumber, c.year, true
    );
  }
  const body = `
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${c.clientName},</p>
    <p style="margin:0 0 14px;">Thank you for your payment.</p>
    <p style="margin:0 0 14px;">We have successfully received <strong>${inr(c.latestPaymentAmount ?? 0)}</strong> for your Deal Confirmation.</p>
    ${balanceTable(c, false)}
    <p style="margin:14px 0 0;">Please complete the remaining payment at your earliest convenience.</p>
    <p style="margin:14px 0 0;">Your updated Payment Receipt is attached${c.receiptNumber ? ` (<span style="font-family:monospace">${c.receiptNumber}</span>)` : ""}.</p>
    <p style="margin:18px 0 0;">Thank you,<br/><strong>Niyom Wealth Distribution LLP</strong></p>`;
  return shellHtml(
    "Payment received. Outstanding balance updated. Receipt attached.",
    body, c.confirmationNumber, c.year, true
  );
}

function fullHtml(c: Ctx): string {
  if (c.payout) {
    const body = `
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${c.clientName},</p>
    <p style="margin:0 0 14px;">Thank you.</p>
    <p style="margin:0 0 14px;">We confirm that the full consideration for your Deal Confirmation has been paid to your registered bank account.</p>
    ${balanceTable(c, false)}
    <p style="margin:14px 0 0;">Your official Payment Advice is attached${c.receiptNumber ? ` (<span style="font-family:monospace">${c.receiptNumber}</span>)` : ""}.</p>
    <p style="margin:18px 0 0;">Thank you for choosing <strong>Niyom Wealth Distribution LLP</strong>.</p>`;
    return shellHtml(
      "Full payment made to your account. Your official advice is attached.",
      body, c.confirmationNumber, c.year, true
    );
  }
  const body = `
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${c.clientName},</p>
    <p style="margin:0 0 14px;">Thank you.</p>
    <p style="margin:0 0 14px;">We confirm that the full payment for your Deal Confirmation has been successfully received.</p>
    ${balanceTable(c, false)}
    <p style="margin:14px 0 0;">Your official Payment Receipt is attached${c.receiptNumber ? ` (<span style="font-family:monospace">${c.receiptNumber}</span>)` : ""}.</p>
    <p style="margin:18px 0 0;">Thank you for choosing <strong>Niyom Wealth Distribution LLP</strong>.</p>`;
  return shellHtml(
    "Full payment received. Your official receipt is attached.",
    body, c.confirmationNumber, c.year, true
  );
}

// ---------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
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
      .select("id, role, status, email")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!employee || employee.status !== "active") {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const { dealId, paymentId } = await req.json().catch(() => ({}));
    if (!dealId && !paymentId) {
      return json({ success: false, error: "dealId or paymentId is required." }, 400);
    }

    // --- Resolve payment (if given) and deal --------------------------
    let payment: any = null;
    let resolvedDealId: string = dealId ?? "";

    if (paymentId) {
      const { data: p } = await db.from("nw_deal_payments")
        .select("id, deal_confirmation_id, payment_number, receipt_number, receipt_pdf_path, receipt_generated_at, receipt_regen_count, amount_inr, updated_at, status")
        .eq("id", paymentId).maybeSingle();
      if (!p) return json({ success: false, error: "Payment not found." }, 404);
      payment = p;
      resolvedDealId = p.deal_confirmation_id;
      if (p.status !== "active") {
        return json({ success: false, error: "Cannot email a cancelled or superseded payment." }, 409);
      }
      if (!p.receipt_pdf_path || !p.receipt_number) {
        return json({ success: false, error: "Generate the receipt before sending it." }, 409);
      }
      // Freshness: any UPDATE to the payment bumps updated_at; finalise sets
      // updated_at == receipt_generated_at, so this comparison holds.
      if (p.receipt_generated_at && new Date(p.updated_at) > new Date(p.receipt_generated_at)) {
        return json({ success: false, error: "Receipt is out of date. Please regenerate it before sending." }, 409);
      }
    }

    const { data: deal } = await db.from("nw_deal_confirmations")
      .select("id, employee_id, acceptance_status, transaction_type, confirmation_number, snap_client_name, snap_email")
      .eq("id", resolvedDealId).maybeSingle();
    if (!deal) return json({ success: false, error: "Deal not found." }, 404);
    // A payment acknowledgement may be issued for a paid deal before the client
    // digitally accepts. Only rejected/expired deals are closed to it.
    // Only a rejected deal is closed; 'expired' is still a live deal.
    if (deal.acceptance_status === "rejected") {
      return json({ success: false, error: "Deal is rejected." }, 409);
    }
    if (!isValidEmail(deal.snap_email)) {
      return json({ success: false, error: "Client email is missing or invalid." }, 400);
    }
    const isAdmin = employee.role === "admin" || employee.role === "super_admin";
    if (!isAdmin && deal.employee_id !== employee.id) {
      return json({ success: false, error: "Forbidden" }, 403);
    }

    // --- Live status ---------------------------------------------------
    const { data: summary } = await db.from("nw_deal_payment_summary")
      .select("deal_amount, total_paid_amount, outstanding_amount, payment_status")
      .eq("deal_id", deal.id).maybeSingle();
    if (!summary) return json({ success: false, error: "Could not read payment summary." }, 500);

    const status = summary.payment_status as "not_paid" | "partially_paid" | "fully_paid";
    // On a Sell the client is the seller and Niyom is the buyer, so the money is
    // owed BY us. Every template below flips wording accordingly, and the
    // reminder ("your payment is pending") has no valid form at all.
    const payout = String(deal.transaction_type ?? "").trim().toLowerCase() === "sell";

    // --- Template selection + payload gating --------------------------
    if (status === "not_paid" && paymentId) {
      return json({ success: false, error: "No payment recorded yet — send a reminder instead." }, 409);
    }
    if (status === "not_paid" && payout) {
      return json({
        success: false,
        error: "This is a Sell deal — Niyom owes the client, so there is no payment to remind them about. Record the payout instead.",
      }, 409);
    }
    if (status !== "not_paid" && !paymentId) {
      return json({ success: false, error: "paymentId is required to send a payment acknowledgement." }, 400);
    }

    let emailType: "payment_reminder" | "payment_partial" | "payment_final";
    let subject: string;
    let text: string;
    let html: string;
    let attach: { filename: string; content: string } | null = null;

    const ctx: Ctx = {
      clientName:         deal.snap_client_name || "Client",
      payout,
      confirmationNumber: deal.confirmation_number,
      dealAmount:         Number(summary.deal_amount),
      totalPaid:          Number(summary.total_paid_amount),
      outstanding:        Number(summary.outstanding_amount),
      latestPaymentAmount: payment ? Number(payment.amount_inr) : undefined,
      receiptNumber:      payment?.receipt_number ?? null,
      year:               new Date().getFullYear(),
    };

    if (status === "not_paid") {
      emailType = "payment_reminder";
      subject   = `Payment Reminder – Deal Confirmation ${deal.confirmation_number}`;
      text      = reminderText(ctx);
      html      = reminderHtml(ctx);
    } else if (status === "partially_paid") {
      emailType = "payment_partial";
      subject   = payout
        ? `Payment Made – Balance Payable Pending`
        : `Payment Received – Outstanding Balance Pending`;
      text      = partialText(ctx);
      html      = partialHtml(ctx);
    } else {
      emailType = "payment_final";
      subject   = payout
        ? `Payment Advice – Payment Completed`
        : `Payment Receipt – Payment Completed`;
      text      = fullText(ctx);
      html      = fullHtml(ctx);
    }

    // --- Attachment (partial + final) ----------------------------------
    if (payment && payment.receipt_pdf_path) {
      const { data: file, error: dlErr } = await db.storage.from(BUCKET)
        .download(payment.receipt_pdf_path);
      if (dlErr || !file) {
        console.error("receipt download error:", dlErr);
        return json({ success: false, error: "Could not fetch the receipt file." }, 500);
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      // base64 encode in chunks
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)));
      }
      attach = { filename: `${payment.receipt_number}.pdf`, content: btoa(bin) };
    }

    // --- Recipients + CC ----------------------------------------------
    const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
    let ownerEmail: string | null = null;
    if (deal.employee_id) {
      const { data: owner } = await db.from("nw_employees").select("email").eq("id", deal.employee_id).maybeSingle();
      ownerEmail = owner?.email ?? null;
    }
    const clientTo = deal.snap_email.trim();
    const cc = buildCc([ownerEmail, adminEmail], clientTo);

    // Is this a resend of the same email_type for this deal?
    const { data: prior } = await db.from("nw_deal_email_log")
      .select("id").eq("deal_confirmation_id", deal.id).eq("email_type", emailType).limit(1).maybeSingle();
    const isResend = !!prior;

    // --- Send ---------------------------------------------------------
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Niyom Wealth <support@niyomwealth.com>",
        to: [clientTo],
        ...(cc.length ? { cc } : {}),
        subject, text, html,
        ...(attach ? { attachments: [attach] } : {}),
      }),
    });
    const respBody = await resendResp.json().catch(() => ({} as any));

    // Log every attempt (best-effort — never mask send outcome)
    const logRow = {
      deal_confirmation_id: deal.id,
      payment_id: payment?.id ?? null,
      email_type: emailType,
      sent_to: clientTo,
      cc_recipients: cc,
      sent_by: employee.id,
      is_resend: isResend,
      status: resendResp.ok ? "sent" : "failed",
      provider_message_id: resendResp.ok ? (respBody?.id ?? null) : null,
      metadata: {
        payment_status_at_send: status,
        receipt_version:        payment?.receipt_regen_count ?? null,
        subject,
        ...(resendResp.ok ? {} : { error: respBody?.message ?? "send failed" }),
      },
    };
    try { await db.from("nw_deal_email_log").insert(logRow); }
    catch (e) { console.error("email log insert failed:", e); }

    if (!resendResp.ok) {
      console.error("resend error:", respBody);
      return json({ success: false, error: respBody?.message || "Failed to send email." }, 502);
    }

    // Event audit
    try {
      await db.from("nw_deal_confirmation_events").insert({
        deal_id: deal.id,
        event_type: "receipt_emailed",
        actor: "employee",
        metadata: {
          email_type:              emailType,
          payment_id:              payment?.id ?? null,
          payment_number:          payment?.payment_number ?? null,
          receipt_number:          payment?.receipt_number ?? null,
          receipt_version:         payment?.receipt_regen_count ?? null,
          payment_status_at_send:  status,
          provider_message_id:     respBody?.id ?? null,
          to:                      clientTo,
          cc,
          is_resend:               isResend,
        },
      });
    } catch (e) { console.error("event insert failed:", e); }

    // "Last emailed" per payment is derived from nw_deal_email_log at read
    // time (filter by payment_id + email_type + latest sent_at). We therefore
    // do NOT try to bump nw_deal_payments.receipt_last_emailed_at here — that
    // would trip the row_version trigger and require a coordinated bump.

    return json({
      success: true,
      email_type: emailType,
      email_id:   respBody?.id ?? null,
      is_resend:  isResend,
    });
  } catch (err: any) {
    console.error("send-payment-acknowledgement error:", err?.message);
    return json({ success: false, error: err?.message || "Internal error." }, 500);
  }
});
