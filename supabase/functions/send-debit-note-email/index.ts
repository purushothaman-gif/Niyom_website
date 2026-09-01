import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders, json, generateToken, formatDesignation, isValidEmail, buildCc, INR, sendEmail,
} from "../_shared/signing.ts";
import { emailFooterHtml, emailFooterText } from "../_shared/email_footer.ts";

// Debit Note signing: sends a SECURE LINK (no PDF attachment) to the DSA
// (payee) so they can review and e-sign the debit note. Requires an
// authenticated employee. Mints/rotates the secure token + 7-day expiry
// server-side, sets the signature lifecycle to 'sent', and records the event.
//
// Refusing to send for a SIGNED note preserves immutability.

const LINK_TTL_DAYS = 7;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "https://www.niyomwealth.com").replace(/\/$/, "");

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

    const { debitNoteId } = await req.json().catch(() => ({}));
    if (!debitNoteId) return json({ success: false, error: "Missing debitNoteId." }, 400);

    // --- Load the debit note + DSA (server-side source of truth) ---
    const { data: note } = await db
      .from("dsa_debit_notes")
      .select("id, debit_note_number, month, year, payout_amount, tds_amount, net_payable_amount, status, signature_status, created_by, dsa:nw_dsa(id, full_name, email, dsa_code, employee_id)")
      .eq("id", debitNoteId)
      .maybeSingle();
    if (!note) return json({ success: false, error: "Debit note not found." }, 404);

    const dsa = (note as any).dsa as { id: string; full_name: string; email: string; dsa_code: string; employee_id: string } | null;

    // Ownership check (admins may send any). Ownership is determined only by the
    // DSA assignment: a non-admin may act on a debit note only when the note's
    // DSA is assigned to them (nw_dsa.employee_id === employee.id).
    const isAdmin = employee.role === "admin" || employee.role === "super_admin";
    const owns = !!dsa && dsa.employee_id === employee.id;
    if (!isAdmin && !owns) return json({ success: false, error: "Forbidden" }, 403);

    if (note.signature_status === "signed") {
      return json({ success: false, error: "This debit note is signed and locked." }, 409);
    }
    if (note.status === "cancelled") {
      return json({ success: false, error: "This debit note is cancelled." }, 409);
    }
    if (!dsa || !dsa.email) {
      return json({ success: false, error: "No DSA email is on record for this debit note." }, 400);
    }
    if (!isValidEmail(dsa.email)) {
      return json({ success: false, error: "The DSA email on record is not a valid address." }, 400);
    }

    // --- CC the owning employee + admin (deduped against the DSA address) ---
    const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
    const dsaTo = dsa.email.trim();
    const ccRecipients = buildCc([employee.email, adminEmail], dsaTo);

    // --- Mint / rotate token (resets the signature lifecycle to 'sent') ---
    const token = generateToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error: updErr } = await db.from("dsa_debit_notes").update({
      secure_token: token,
      token_expires_at: expiresAt,
      signature_status: "sent",
      viewed_at: null,
      sent_at: new Date().toISOString(),
      sent_by: employee.id,
    }).eq("id", note.id);
    if (updErr) {
      console.error("debit-note token update error:", updErr);
      return json({ success: false, error: "Could not prepare the secure link." }, 500);
    }

    const link = `${appUrl}/debit-note/${token}`;
    const designation = formatDesignation(employee.designation);
    const expiryIst = new Date(expiresAt).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
    const periodStr = `${MONTHS[note.month - 1]} ${note.year}`;
    const year = new Date().getFullYear();
    const subject = `Debit Note for your review & signature – ${note.debit_note_number}`;

    const text = `Dear ${dsa.full_name},

Your Debit Note for ${periodStr} is now available for review and signature.

  Debit Note No.:  ${note.debit_note_number}
  Gross Payout:    ${INR(note.payout_amount)}
  TDS @ 2%:        - ${INR(note.tds_amount)}
  Net Payable:     ${INR(note.net_payable_amount)}

Please review the complete debit note on the secure link below. Once you are
comfortable with the particulars, you may acknowledge it using a one-time
password sent to this email, followed by a brief electronic signature.

The link is unique to you and remains active until ${expiryIst} IST.

${link}

If you have any questions before signing, please feel free to reach out to me directly.

Warm regards,

${employee.full_name}
${designation} | Niyom Wealth Distribution LLP
M: ${employee.phone}   E: ${employee.email}

---
For your security, Niyom Wealth will never ask you to share OTPs, passwords, or this secure link.

${emailFooterText({ year, ref: note.debit_note_number })}`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f6f6f6;">
    Please review and sign your debit note at your convenience.
  </div>
  <div style="max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">
    <div style="border-bottom:2px solid #D4AF37;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#111;">Niyom Wealth</div>
    </div>
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${dsa.full_name},</p>
    <p style="margin:0 0 14px;">Your Debit Note for <strong>${periodStr}</strong> is now available for your review and signature.</p>
    <table style="border-collapse:collapse;margin:0 0 18px;width:100%;max-width:420px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#555;">Debit Note No.</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#111;">${note.debit_note_number}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Gross Payout</td><td style="padding:6px 0;text-align:right;color:#111;">${INR(note.payout_amount)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">TDS @ 2%</td><td style="padding:6px 0;text-align:right;color:#b91c1c;">- ${INR(note.tds_amount)}</td></tr>
      <tr><td style="padding:10px 0;border-top:2px solid #111;font-weight:700;color:#111;">Net Payable</td><td style="padding:10px 0;border-top:2px solid #111;text-align:right;font-weight:800;color:#0f766e;">${INR(note.net_payable_amount)}</td></tr>
    </table>
    <p style="margin:0 0 14px;">Once you are comfortable with the particulars, you may acknowledge it using a one-time password sent to this email, followed by a brief electronic signature.</p>
    <p style="margin:0 0 14px;">The link is unique to you and remains active until <strong>${expiryIst} IST</strong>.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${link}" style="background:linear-gradient(135deg,#D4AF37,#B8961E);color:#000;
         text-decoration:none;font-weight:700;padding:14px 28px;border-radius:8px;display:inline-block;">
         Review &amp; Sign Debit Note
      </a>
    </div>
    <p style="font-size:13px;color:#777;margin:0 0 14px;">If the button does not open, please copy this link into your browser:<br/>
       <a href="${link}" style="color:#B8961E;word-break:break-all;">${link}</a></p>
    <p style="margin:18px 0 0;">If you have any questions before signing, please feel free to reach out to me directly.</p>
    <p style="margin:18px 0 6px;">Warm regards,</p>
    <div>
      <div style="font-weight:700;color:#111;">${employee.full_name}</div>
      <div style="color:#555;font-size:13px;line-height:1.7;">
        ${designation} &nbsp;|&nbsp; Niyom Wealth Distribution LLP<br/>
        M: ${employee.phone} &nbsp; E: <a href="mailto:${employee.email}" style="color:#B8961E;">${employee.email}</a>
      </div>
    </div>
    <p style="margin:28px 0 0;font-size:12px;color:#666;line-height:1.7;">For your security, Niyom Wealth will never ask you to share OTPs, passwords, or this secure link.</p>
    ${emailFooterHtml({ year, ref: note.debit_note_number })}
  </div>
</body></html>`;

    const result = await sendEmail({ apiKey: RESEND_API_KEY, to: dsaTo, cc: ccRecipients, subject, html, text });
    if (!result.ok) {
      console.error("Resend API error (send-debit-note-email):", result.error);
      return json({ success: false, error: "Failed to send email." }, 500);
    }

    await db.from("dsa_debit_note_events").insert({
      debit_note_id: note.id, event_type: "link_sent", actor: "employee",
      metadata: { emailId: result.id, to: dsaTo, cc: ccRecipients },
    });

    return json({ success: true, emailId: result.id });
  } catch (err: any) {
    console.error("send-debit-note-email error:", err?.message);
    return json({ success: false, error: err?.message || "Internal server error." }, 500);
  }
});
