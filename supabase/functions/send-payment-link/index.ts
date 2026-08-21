import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailFooterHtml, emailFooterText } from "../_shared/email_footer.ts";
import { getPaymentGateway } from "../_shared/paymentGateway.ts";

// Sprint 2 — Cashfree Payment Link.
//
// Employee-triggered (owner or admin). For an ACCEPTED deal with an
// outstanding balance, this function:
//   1. creates a real Cashfree Payment Link for the outstanding amount, and
//   2. emails the client two payment options:
//        Option 1 — Pay Online (UPI / Debit Card) via a "Pay Securely" button
//                   that opens the Cashfree link.
//        Option 2 — Manual Bank Transfer (NEFT / RTGS / IMPS) with company bank
//                   details and a "reply with screenshot" instruction.
//
// This function only GENERATES + SENDS the link. Money capture (Cashfree
// webhook -> nw_insert_payment on the existing nw_deal_payments gateway
// columns) is a later sprint. The send is logged to nw_deal_email_log with
// email_type='payment_link' and metadata carrying the Cashfree link id, so the
// future webhook can correlate the payment back to this deal.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// --- Company bank details (Option 2) ---------------------------------------
// Mirrors the production NIYOM_BANK constant used on Deal Confirmation notes
// and DSA debit notes, so the payment email matches documents the client
// already holds. Edge functions cannot import from src/, hence the local copy.
// If official bank details change, update here (and the src/ constant).
const NIYOM_BANK = {
  accountName: "Niyom Wealth Distribution LLP",
  bank: "IDFC FIRST BANK",
  account: "89394331135",
  ifsc: "IDFB0080131",
  branch: "Anna Nagar, Chennai",
};


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

// Normalize an Indian mobile number to the 10-digit form Cashfree expects.
function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // --- Cashfree gateway (secrets live server-side only, never client-side) ---
    // Chooses the droplet relay when PAY_RELAY_URL/PAY_RELAY_SECRET are set, and
    // calls Cashfree directly otherwise. The relay exists because Cashfree
    // whitelists the droplet's static IP and this function has no stable egress
    // address — see _shared/paymentGateway.ts. Env-switch hardening (trimmed
    // credentials, case-insensitive CASHFREE_ENV) moved there with it.
    const gateway = getPaymentGateway();
    if (!gateway) {
      return json({ success: false, error: "Payment gateway is not configured." }, 500);
    }

    // --- Authenticate the calling employee ---
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
      .select("id, role, status, full_name, designation, email, phone")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!employee || employee.status !== "active") {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const { dealId, amount: rawAmount } = await req.json().catch(() => ({}));
    if (!dealId) return json({ success: false, error: "dealId is required." }, 400);

    // --- Load the deal (server-side source of truth) ---
    const { data: deal } = await db
      .from("nw_deal_confirmations")
      .select("id, employee_id, acceptance_status, transaction_type, confirmation_number, snap_client_name, snap_email, snap_phone")
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return json({ success: false, error: "Deal not found." }, 404);

    const isAdmin = employee.role === "admin" || employee.role === "super_admin";
    if (!isAdmin && deal.employee_id !== employee.id) {
      return json({ success: false, error: "Forbidden" }, 403);
    }
    // Acceptance was removed from the internal deal flow — a payment link may be
    // sent for any live deal (the flow is: create → send link → client pays →
    // record payment → transfer queue). Only a rejected deal is blocked, matching
    // record-payment / upload-receipt / transfer-deal.
    if (deal.acceptance_status === "rejected") {
      return json({ success: false, error: "A payment link cannot be sent for a rejected deal." }, 409);
    }
    // On a Sell the client is the seller and Niyom is the buyer: the money is
    // owed BY us TO them. A Cashfree link charges the client, so it would
    // collect the settlement a second time from the wrong side of the deal.
    // The UI already hides the card; this is the authoritative refusal.
    if (String(deal.transaction_type ?? "").trim().toLowerCase() === "sell") {
      return json({
        success: false,
        error: "This is a Sell deal — the client is the seller and Niyom is the payer. Record the payout instead of collecting from the client.",
      }, 409);
    }
    if (!isValidEmail(deal.snap_email)) {
      return json({ success: false, error: "The client email on record is not a valid address." }, 400);
    }
    const customerPhone = normalizePhone(deal.snap_phone);
    if (!customerPhone) {
      return json({ success: false, error: "A valid client mobile number is required to create a payment link." }, 400);
    }

    // --- Amount to collect = current outstanding balance ---
    const { data: summary } = await db
      .from("nw_deal_payment_summary")
      .select("outstanding_amount, payment_status")
      .eq("deal_id", deal.id)
      .maybeSingle();
    if (!summary) return json({ success: false, error: "Could not read payment summary." }, 500);

    const outstanding = Math.round(Number(summary.outstanding_amount) * 100) / 100;
    if (summary.payment_status === "fully_paid" || outstanding <= 0) {
      return json({ success: false, error: "This deal is already fully paid." }, 409);
    }

    // --- Sprint 9: employee-entered amount (optional). The CURRENT outstanding is
    // the single business ceiling. If amount is omitted, preserve the prior
    // behaviour (charge the full outstanding). Validated server-side (authoritative).
    let chargeAmount = outstanding;
    if (rawAmount !== undefined && rawAmount !== null && rawAmount !== "") {
      const amt = Math.round(Number(rawAmount) * 100) / 100;
      if (!Number.isFinite(amt) || amt <= 0) {
        return json({ success: false, error: "Enter a valid payment amount greater than 0." }, 400);
      }
      if (amt > outstanding) {
        return json({ success: false, error: `Amount cannot exceed the outstanding balance of ${inr(outstanding)}.` }, 400);
      }
      chargeAmount = amt;
    }

    // --- Create the Cashfree Payment Link -------------------------------
    // link_id must be unique per account; the confirmation number + a short
    // time suffix keeps it human-traceable and prevents "already exists" on
    // resend. Enabled methods (UPI / Debit Card) are governed by the Cashfree
    // account configuration.
    const clientTo = deal.snap_email.trim();
    const linkId = `${deal.confirmation_number}-${Date.now().toString(36)}`
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .slice(0, 50);

    let linkUrl: string | null = null;
    let cfLinkStatus: string | null = null;
    try {
      const result = await gateway.createLink({
        link_id: linkId,
        link_amount: chargeAmount,
        link_currency: "INR",
        link_purpose: `Payment for Deal Confirmation ${deal.confirmation_number}`,
        customer_details: {
          customer_name: deal.snap_client_name || "Client",
          customer_email: clientTo,
          customer_phone: customerPhone,
        },
        // We send our own branded email; suppress Cashfree's notifications.
        link_notify: { send_sms: false, send_email: false },
      });
      if (!result.ok) {
        console.error(`Cashfree link error (${gateway.kind}, status ${result.status}):`, result.error);
        return json({ success: false, error: result.error ?? "Could not create the payment link." }, 502);
      }
      linkUrl = result.link_url;
      cfLinkStatus = result.link_status;
    } catch (cfErr: any) {
      // Network-level failure reaching Cashfree or the relay.
      console.error(`Cashfree request failed (${gateway.kind}):`, cfErr?.message);
      return json({ success: false, error: "Payment gateway is unavailable. Please try again." }, 502);
    }
    if (!linkUrl) {
      return json({ success: false, error: "Payment link could not be created." }, 502);
    }

    // --- Retire the deal's earlier links ---------------------------------
    // Without this, every resend leaves another live link for the SAME money.
    // Nothing stops a client paying two of them, and the webhook would rightly
    // record both (they are genuinely distinct payments with distinct
    // cf_payment_ids) — leaving the deal overpaid and needing a manual unwind.
    //
    // Deliberately AFTER creation: cancelling first would, on a creation
    // failure, leave the client holding no working link at all.
    //
    // Best-effort by design. A failure here must never fail the send — the new
    // link is already live and the client is waiting on the email. Most
    // failures are benign: Cashfree refuses to cancel a link that is already
    // PAID or EXPIRED, which is exactly the protection we want, since it means
    // a settled payment can never be closed off by this path. We never judge
    // locally whether a link is still open — our stored link_status is only the
    // status at creation time, so Cashfree's own state is the authority.
    const priorLinks: { id: string; linkId: string }[] = [];
    try {
      const { data: priorRows } = await db
        .from("nw_deal_email_log")
        .select("id, metadata")
        .eq("deal_confirmation_id", deal.id)
        .eq("email_type", "payment_link")
        .order("sent_at", { ascending: false })
        .limit(20);
      for (const row of priorRows ?? []) {
        const prevId = (row.metadata as { cashfree_link_id?: string } | null)?.cashfree_link_id;
        if (prevId && prevId !== linkId) priorLinks.push({ id: row.id, linkId: prevId });
      }
    } catch (e) {
      console.error("prior-link lookup failed:", (e as Error)?.message);
    }

    const cancelledLinks: string[] = [];
    for (const prev of priorLinks) {
      try {
        const res = await gateway.cancelLink(prev.linkId);
        if (res.ok) {
          cancelledLinks.push(prev.linkId);
          console.log(`Cancelled prior payment link ${prev.linkId} on ${deal.confirmation_number}`);
        } else {
          console.warn(`Prior link ${prev.linkId} not cancelled (${res.status}): ${res.error}`);
        }
      } catch (e) {
        console.warn(`Prior link ${prev.linkId} cancel threw:`, (e as Error)?.message);
      }
    }

    // --- Recipients: To = client, CC = owner + admin (payment-email pattern) ---
    const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
    let ownerEmail: string | null = null;
    if (deal.employee_id) {
      const { data: owner } = await db.from("nw_employees").select("email").eq("id", deal.employee_id).maybeSingle();
      ownerEmail = owner?.email ?? null;
    }
    const cc = buildCc([ownerEmail, adminEmail], clientTo);

    const year = new Date().getFullYear();
    const amountLabel = inr(chargeAmount);
    const subject = `Payment Link – Deal Confirmation ${deal.confirmation_number}`;

    const upiNote = "UPI transactions are generally limited to ₹1,00,000 per day by most banks. If you have already made UPI transactions today, your available limit may be lower.";
    const bankReplyNote = "After successfully completing the bank transfer, kindly reply to this email with your payment confirmation screenshot for verification.";

    const text = `Dear ${deal.snap_client_name || "Client"},

Please complete the payment of ${amountLabel} for your Deal Confirmation (Ref ${deal.confirmation_number}). You may use either option below.

OPTION 1 — Pay Online (UPI / Debit Card)
Pay securely using this link:
${linkUrl}

Note: ${upiNote}

OPTION 2 — Manual Bank Transfer (NEFT / RTGS / IMPS)
Account Name: ${NIYOM_BANK.accountName}
Bank: ${NIYOM_BANK.bank}
Account Number: ${NIYOM_BANK.account}
IFSC: ${NIYOM_BANK.ifsc}
Branch: ${NIYOM_BANK.branch}

${bankReplyNote}

For any assistance, please reach out to your Relationship Manager.

Warm regards,
${employee.full_name}
${(employee.designation && employee.designation.trim()) || "Relationship Manager"} | Niyom Wealth Distribution LLP
M: ${employee.phone ?? "-"}   E: ${employee.email ?? "-"}

---
For your security, Niyom Wealth will never ask you to share OTPs, passwords, or card details over the phone or email.

${emailFooterText({ year, ref: deal.confirmation_number })}`;

    const bankRow = (label: string, value: string) =>
      `<tr><td style="padding:5px 12px;color:#666;font-size:13px;">${label}</td>
        <td style="padding:5px 12px;color:#111;font-size:13px;font-weight:600;text-align:right;">${value}</td></tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f6f6f6;">
    Complete your payment of ${amountLabel} for Deal Confirmation ${deal.confirmation_number}.
  </div>
  <div style="max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">
    <div style="border-bottom:2px solid #D4AF37;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#111;">Niyom Wealth</div>
    </div>
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${deal.snap_client_name || "Client"},</p>
    <p style="margin:0 0 8px;">Please complete the payment for your Deal Confirmation <strong>Ref ${deal.confirmation_number}</strong>.</p>
    <p style="margin:0 0 18px;">Amount payable: <strong>${amountLabel}</strong></p>

    <div style="border:1px solid #eee;border-radius:10px;padding:18px;margin:0 0 16px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#111;letter-spacing:.02em;">OPTION 1 — Pay Online (UPI / Debit Card)</p>
      <div style="text-align:center;margin:16px 0;">
        <a href="${linkUrl}" style="background:linear-gradient(135deg,#D4AF37,#B8961E);color:#000;
           text-decoration:none;font-weight:700;padding:14px 30px;border-radius:8px;display:inline-block;">
           Pay Securely
        </a>
      </div>
      <p style="font-size:13px;color:#777;margin:0 0 10px;">If the button does not open, copy this link into your browser:<br/>
         <a href="${linkUrl}" style="color:#B8961E;word-break:break-all;">${linkUrl}</a></p>
      <p style="font-size:12px;color:#8a6d1a;background:#fbf6e6;border:1px solid #f0e2b6;border-radius:6px;padding:10px 12px;margin:0;">
        ${upiNote}</p>
    </div>

    <div style="border:1px solid #eee;border-radius:10px;padding:18px;margin:0 0 16px;">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#111;letter-spacing:.02em;">OPTION 2 — Manual Bank Transfer (NEFT / RTGS / IMPS)</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:6px;">
        <tbody>
          ${bankRow("Account Name", NIYOM_BANK.accountName)}
          ${bankRow("Bank", NIYOM_BANK.bank)}
          ${bankRow("Account Number", NIYOM_BANK.account)}
          ${bankRow("IFSC", NIYOM_BANK.ifsc)}
          ${bankRow("Branch", NIYOM_BANK.branch)}
        </tbody>
      </table>
      <p style="font-size:12px;color:#555;margin:12px 0 0;">${bankReplyNote}</p>
    </div>

    <p style="margin:18px 0 0;">For any assistance, please reach out to your Relationship Manager.</p>
    <p style="margin:18px 0 6px;">Warm regards,</p>
    <div>
      <div style="font-weight:700;color:#111;">${employee.full_name}</div>
      <div style="color:#555;font-size:13px;line-height:1.7;">
        ${(employee.designation && employee.designation.trim()) || "Relationship Manager"} &nbsp;|&nbsp; Niyom Wealth Distribution LLP<br/>
        M: ${employee.phone ?? "-"} &nbsp; E: <a href="mailto:${employee.email ?? ""}" style="color:#B8961E;">${employee.email ?? "-"}</a>
      </div>
    </div>
    <p style="margin:28px 0 0;font-size:12px;color:#666;line-height:1.7;">For your security, Niyom Wealth will never ask you to share OTPs, passwords, or card details.</p>
    ${emailFooterHtml({ year, ref: deal.confirmation_number })}
  </div>
</body></html>`;

    // Is this a resend of a payment link for this deal?
    const { data: prior } = await db.from("nw_deal_email_log")
      .select("id").eq("deal_confirmation_id", deal.id).eq("email_type", "payment_link").limit(1).maybeSingle();
    const isResend = !!prior;

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Niyom Wealth <support@niyomwealth.com>",
        to: [clientTo],
        ...(cc.length ? { cc } : {}),
        subject, text, html,
      }),
    });
    const respBody = await resendResp.json().catch(() => ({} as any));

    // Append-only email audit (also carries the Cashfree link id so a future
    // webhook can correlate the payment back to this deal). Best-effort log.
    try {
      await db.from("nw_deal_email_log").insert({
        deal_confirmation_id: deal.id,
        payment_id: null,
        email_type: "payment_link",
        sent_to: clientTo,
        cc_recipients: cc,
        sent_by: employee.id,
        is_resend: isResend,
        status: resendResp.ok ? "sent" : "failed",
        provider_message_id: resendResp.ok ? (respBody?.id ?? null) : null,
        metadata: {
          cashfree_link_id: linkId,
          cashfree_link_status: cfLinkStatus,
          link_url: linkUrl,
          amount: chargeAmount,
          // Which earlier links this send retired. Recorded on the NEW row
          // rather than by updating the old ones, because this table is an
          // append-only audit — the prior rows must keep saying what was true
          // when they were written.
          ...(cancelledLinks.length ? { cancelled_prior_links: cancelledLinks } : {}),
          ...(resendResp.ok ? {} : { error: respBody?.message ?? "send failed" }),
        },
      });
    } catch (logErr) {
      console.error("email-log insert failed:", logErr);
    }

    if (!resendResp.ok) {
      console.error("resend error:", respBody);
      return json({ success: false, error: respBody?.message || "The payment link was created but the email could not be sent." }, 502);
    }

    return json({ success: true, link_url: linkUrl, email_id: respBody?.id ?? null, is_resend: isResend });
  } catch (err: any) {
    console.error("send-payment-link error:", err?.message);
    return json({ success: false, error: err?.message || "Internal error." }, 500);
  }
});
