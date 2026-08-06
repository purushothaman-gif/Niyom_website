import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailFooterHtml, emailFooterText } from "../_shared/email_footer.ts";
import { asJson } from '../_shared/json.ts';

// Deal Confirmation v2: sends a SECURE LINK (not a PDF attachment) to the
// client. Requires an authenticated employee. Mints/rotates the secure token
// and a 7-day expiry server-side, then records that the link was sent.
//
// Refusing to send for an ACCEPTED deal preserves the immutability rule.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const LINK_TTL_DAYS = 7;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Client-facing job title — use display-only `designation`, never the internal `role`.
function formatDesignation(designation: string | null | undefined): string {
  return (designation && designation.trim()) || "Relationship Manager";
}

const isValidEmail = (e: unknown): e is string =>
  typeof e === "string" && /^\S+@\S+\.\S+$/.test(e.trim());

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "https://niyomwealth.com").replace(/\/$/, "");

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
      .select("id, full_name, role, designation, email, phone")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!employee) return json({ success: false, error: "Unauthorized" }, 401);

    const { dealId } = await req.json().catch(() => ({}));
    if (!dealId) return json({ success: false, error: "Missing dealId." }, 400);

    // --- Load the deal (server-side source of truth) ---
    const { data: deal } = await db
      .from("nw_deal_confirmations")
      .select("id, confirmation_number, snap_client_name, snap_email, acceptance_status, employee_id, email_status")
      .eq("id", dealId)
      .maybeSingle();
    if (!deal) return json({ success: false, error: "Deal not found." }, 404);

    // Ownership check (admins may send any)
    const isAdmin = employee.role === "admin" || employee.role === "super_admin";
    if (!isAdmin && deal.employee_id !== employee.id) {
      return json({ success: false, error: "Forbidden" }, 403);
    }

    if (deal.acceptance_status === "accepted") {
      return json({ success: false, error: "This deal is accepted and locked. Create a new deal for changes." }, 409);
    }
    if (!deal.snap_email) {
      return json({ success: false, error: "No client email is on record for this deal." }, 400);
    }
    if (!isValidEmail(deal.snap_email)) {
      return json({ success: false, error: "The client email on record is not a valid address." }, 400);
    }

    // --- Recipients: the initial Deal Confirmation link goes to the CLIENT ONLY.
    // No CC. Admin/employee retain full visibility via the CRM and the append-only
    // nw_deal_email_log. (Resend uses this same path, so it inherits the rule.)
    const clientTo = deal.snap_email.trim();
    const ccRecipients: string[] = [];
    const isResend = deal.email_status === "sent";

    // --- Mint / rotate token (resets to pending for a fresh review) ---
    const token = generateToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error: updErr } = await db.from("nw_deal_confirmations").update({
      secure_token: token,
      token_expires_at: expiresAt,
      acceptance_status: "pending",
      viewed_at: null,
      email_status: "sent",
      email_sent_at: new Date().toISOString(),
      email_sent_by: employee.id,
    }).eq("id", deal.id);
    if (updErr) {
      console.error("token update error:", updErr);
      return json({ success: false, error: "Could not prepare the secure link." }, 500);
    }

    const link = `${appUrl}/deal/${token}`;
    const designation = formatDesignation(employee.designation);
    const expiryIst = new Date(expiresAt).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
    const year = new Date().getFullYear();
    const subject = `Your Deal Confirmation Note – Ref ${deal.confirmation_number}`;

    const text = `Dear ${deal.snap_client_name},

Your Deal Confirmation Note is now available for review and confirmation. The complete details are available on the secure link below for your review.

Once you are comfortable with the particulars, you may confirm the transaction using a one-time password sent to this email, followed by a brief electronic signature. If you would prefer to decline, the same option is available on the page.

The link is unique to you and remains active until ${expiryIst} IST.

${link}

If you have any questions before confirming, please feel free to reach out to me directly.

Warm regards,

${employee.full_name}
${designation} | Niyom Wealth Distribution LLP
M: ${employee.phone}   E: ${employee.email}

---
For your security, Niyom Wealth will never ask you to share OTPs, passwords, or this secure link.

${emailFooterText({ year, ref: deal.confirmation_number })}`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f6f6f6;">
    Please review and confirm the transaction at your convenience.
  </div>
  <div style="max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">
    <div style="border-bottom:2px solid #D4AF37;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#111;">Niyom Wealth</div>
    </div>
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${deal.snap_client_name},</p>
    <p style="margin:0 0 14px;">Your Deal Confirmation Note is now available for review and confirmation. The complete details are available on the secure link below for your review.</p>
    <p style="margin:0 0 14px;">Once you are comfortable with the particulars, you may confirm the transaction using a one-time password sent to this email, followed by a brief electronic signature. If you would prefer to decline, the same option is available on the page.</p>
    <p style="margin:0 0 14px;">The link is unique to you and remains active until <strong>${expiryIst} IST</strong>.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${link}" style="background:linear-gradient(135deg,#D4AF37,#B8961E);color:#000;
         text-decoration:none;font-weight:700;padding:14px 28px;border-radius:8px;display:inline-block;">
         Review Confirmation Note
      </a>
    </div>
    <p style="font-size:13px;color:#777;margin:0 0 14px;">If the button does not open, please copy this link into your browser:<br/>
       <a href="${link}" style="color:#B8961E;word-break:break-all;">${link}</a></p>
    <p style="margin:18px 0 0;">If you have any questions before confirming, please feel free to reach out to me directly.</p>
    <p style="margin:18px 0 6px;">Warm regards,</p>
    <div>
      <div style="font-weight:700;color:#111;">${employee.full_name}</div>
      <div style="color:#555;font-size:13px;line-height:1.7;">
        ${designation} &nbsp;|&nbsp; Niyom Wealth Distribution LLP<br/>
        M: ${employee.phone} &nbsp; E: <a href="mailto:${employee.email}" style="color:#B8961E;">${employee.email}</a>
      </div>
    </div>
    <p style="margin:28px 0 0;font-size:12px;color:#666;line-height:1.7;">For your security, Niyom Wealth will never ask you to share OTPs, passwords, or this secure link.</p>
    ${emailFooterHtml({ year, ref: deal.confirmation_number })}
  </div>
</body></html>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Niyom Wealth <support@niyomwealth.com>",
        to: [clientTo],
        ...(ccRecipients.length ? { cc: ccRecipients } : {}),
        subject,
        text,
        html,
      }),
    });

    // Append-only email audit row (best-effort: never let an audit-write failure
    // break or mask the actual email outcome).
    const logEmail = async (status: "sent" | "failed", msgId: string | null, extra: Record<string, unknown> = {}) => {
      try {
        await db.from("nw_deal_email_log").insert({
          deal_confirmation_id: deal.id, email_type: "secure_link",
          sent_to: clientTo, cc_recipients: ccRecipients, sent_by: employee.id,
          is_resend: isResend, status, provider_message_id: msgId, metadata: asJson(extra),
        });
      } catch (logErr) {
        console.error("email-log insert failed:", logErr);
      }
    };

    const resendData = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      await logEmail("failed", null, { error: resendData?.message ?? "send failed" });
      return json({ success: false, error: resendData?.message || "Failed to send email." }, 500);
    }

    await db.from("nw_deal_confirmation_events").insert({
      deal_id: deal.id, event_type: "link_sent", actor: "employee",
      metadata: { emailId: resendData.id, to: clientTo, cc: ccRecipients, resend: isResend },
    });
    await logEmail("sent", resendData.id ?? null);

    return json({ success: true, emailId: resendData.id });
  } catch (err: any) {
    console.error("send-deal-confirmation-email error:", err?.message);
    return json({ success: false, error: err.message || "Internal server error." }, 500);
  }
});
