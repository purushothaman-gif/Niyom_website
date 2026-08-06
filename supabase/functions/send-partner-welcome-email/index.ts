/**
 * send-partner-welcome-email — tells a DSA their partner portal is ready and
 * how to get in.
 *
 * Deliberately carries NO password. The partner sets their own via the
 * Forgot Password flow (send-partner-reset-otp → a 6-digit code to their
 * registered address), so no credential ever travels by email or WhatsApp and
 * the RM never has to read a temporary password out over the phone.
 *
 * That flow requires dsa_login_enabled = true AND an existing auth user, which
 * is exactly what this function refuses to send without — mailing "your portal
 * is ready" to someone who cannot actually sign in would be worse than not
 * mailing at all.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, isValidEmail, sendEmail } from "../_shared/signing.ts";
import { emailFooterHtml, emailFooterText, NOTICE_RECIPIENT } from "../_shared/email_footer.ts";

const SITE = "https://www.niyomwealth.com";
const LOGIN_URL = `${SITE}/partner-login`;

/** Kept in sync with _shared/pin.ts DEVICE_DAYS and the reset OTP's 5-minute TTL. */
const PIN_DAYS = 30;
const OTP_MINUTES = 5;

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Vars {
  partnerName: string;
  dsaCode: string;
  pan: string;
  rmName: string;
  rmPhone: string;
  rmEmail: string;
}

function buildHtml(v: Vars): string {
  const year = new Date().getFullYear();
  const row = (n: string, text: string) => `
    <tr>
      <td valign="top" style="width:26px;padding:0 0 10px;">
        <div style="width:20px;height:20px;border-radius:10px;background:#C8A96A;color:#0B1B2B;
                    font:700 12px/20px Arial,sans-serif;text-align:center;">${n}</div>
      </td>
      <td style="padding:0 0 10px;color:#333;font:14px/1.55 Arial,sans-serif;">${text}</td>
    </tr>`;

  const bullet = (text: string) => `
    <tr><td style="padding:0 0 7px;color:#333;font:14px/1.55 Arial,sans-serif;">
      <span style="color:#C8A96A;">&bull;</span>&nbsp; ${text}
    </td></tr>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F4F6F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0"
       style="width:600px;max-width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;">

  <tr><td style="background:#0B1B2B;padding:22px 28px;">
    <div style="color:#C8A96A;font:700 18px/1.3 Arial,sans-serif;">Your Partner Portal is ready</div>
    <div style="color:#9FB0C0;font:13px/1.4 Arial,sans-serif;padding-top:4px;">Niyom Wealth Distribution LLP</div>
  </td></tr>

  <tr><td style="padding:26px 28px 6px;">
    <p style="margin:0 0 14px;color:#111;font:15px/1.6 Arial,sans-serif;">Dear <strong>${esc(v.partnerName)}</strong>,</p>
    <p style="margin:0 0 18px;color:#333;font:14px/1.6 Arial,sans-serif;">
      Your partner login for <strong>${esc(v.dsaCode)}</strong> is now active. You can sign in any
      time to see the clients you have introduced, your payout statements and your referral link —
      without having to call us for an update.
    </p>
  </td></tr>

  <tr><td style="padding:0 28px;"><div style="height:1px;background:#E6EAEE;"></div></td></tr>

  <tr><td style="padding:18px 28px 4px;">
    <p style="margin:0 0 10px;color:#0B1B2B;font:700 14px/1.4 Arial,sans-serif;">What you can do in the portal</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${bullet("See every client you have sourced, along with their portfolio")}
      ${bullet("View each payout statement — gross, TDS deducted and net payable — and download the PDF")}
      ${bullet("Share your personal referral link and see how many accounts it has opened")}
      ${bullet("Pass a new prospect to your relationship manager, and follow what happens to them")}
    </table>
  </td></tr>

  <tr><td style="padding:14px 28px 0;"><div style="height:1px;background:#E6EAEE;"></div></td></tr>

  <tr><td style="padding:18px 28px 4px;">
    <p style="margin:0 0 12px;color:#0B1B2B;font:700 14px/1.4 Arial,sans-serif;">Signing in for the first time</p>
    <p style="margin:0 0 14px;color:#333;font:14px/1.6 Arial,sans-serif;">
      Go to <a href="${LOGIN_URL}" style="color:#0B1B2B;font-weight:bold;">niyomwealth.com/partner-login</a>
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      ${row("1", `Enter your PAN — <strong>${esc(v.pan)}</strong> — this is your user ID.`)}
      ${row("2", `Tap <strong>Forgot Password</strong>. Enter your PAN again, and we will email a 6-digit code to this address. The code is valid for <strong>${OTP_MINUTES} minutes</strong>.`)}
      ${row("3", "Enter the code and choose your own password. That is all — you are in.")}
    </table>
    <p style="margin:8px 0 0;color:#555;font:italic 13px/1.55 Arial,sans-serif;">
      We never send you a password by email or WhatsApp. You set it yourself, and only you know it.
    </p>
  </td></tr>

  <tr><td style="padding:16px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#F7F4EC;border:1px solid #E8DCC0;border-radius:8px;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0 0 6px;color:#0B1B2B;font:700 13px/1.4 Arial,sans-serif;">
          Signing in faster next time (optional)
        </p>
        <p style="margin:0;color:#444;font:13px/1.6 Arial,sans-serif;">
          Once you are signed in, the portal will offer to set a <strong>4-digit PIN</strong> for that
          device. After that you can sign in with just the PIN on that phone or computer for
          <strong>${PIN_DAYS} days</strong>, and your password continues to work everywhere.
          Please do not set a PIN on a shared or public computer.
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 28px 0;"><div style="height:1px;background:#E6EAEE;"></div></td></tr>

  <tr><td style="padding:16px 28px 22px;">
    <p style="margin:0 0 6px;color:#0B1B2B;font:700 14px/1.4 Arial,sans-serif;">Need help?</p>
    <p style="margin:0 0 14px;color:#333;font:14px/1.6 Arial,sans-serif;">
      Your relationship manager <strong>${esc(v.rmName)}</strong>
      ${v.rmPhone ? ` is on <a href="tel:${esc(v.rmPhone)}" style="color:#0B1B2B;">${esc(v.rmPhone)}</a>` : ""}
      ${v.rmEmail ? ` &middot; <a href="mailto:${esc(v.rmEmail)}" style="color:#0B1B2B;">${esc(v.rmEmail)}</a>` : ""}
    </p>
    <p style="margin:0;color:#8A6D3B;font:13px/1.6 Arial,sans-serif;">
      Niyom Wealth will never ask you for your password or your 6-digit code.
      If anyone does, please tell your relationship manager.
    </p>
  </td></tr>

  <!-- emailFooterHtml returns a complete <table>, so it needs its own row here
       rather than sitting bare between <tr>s (which clients would hoist out). -->
  <tr><td style="padding:0 28px 22px;">
    ${emailFooterHtml({ year, ref: v.dsaCode, notice: NOTICE_RECIPIENT })}
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function buildText(v: Vars): string {
  return [
    `Dear ${v.partnerName},`,
    ``,
    `Your partner login for ${v.dsaCode} is now active. You can sign in any time to see the`,
    `clients you have introduced, your payout statements and your referral link.`,
    ``,
    `WHAT YOU CAN DO IN THE PORTAL`,
    `- See every client you have sourced, along with their portfolio`,
    `- View each payout statement (gross, TDS deducted, net payable) and download the PDF`,
    `- Share your personal referral link and see how many accounts it has opened`,
    `- Pass a new prospect to your relationship manager, and follow what happens to them`,
    ``,
    `SIGNING IN FOR THE FIRST TIME`,
    `Go to ${LOGIN_URL}`,
    `1. Enter your PAN - ${v.pan} - this is your user ID.`,
    `2. Tap "Forgot Password". Enter your PAN again and we will email a 6-digit code to this`,
    `   address. The code is valid for ${OTP_MINUTES} minutes.`,
    `3. Enter the code and choose your own password. That is all - you are in.`,
    ``,
    `We never send you a password by email or WhatsApp. You set it yourself.`,
    ``,
    `SIGNING IN FASTER NEXT TIME (OPTIONAL)`,
    `Once signed in, the portal offers to set a 4-digit PIN for that device. You can then sign`,
    `in with just the PIN on that phone or computer for ${PIN_DAYS} days, and your password still`,
    `works everywhere. Please do not set a PIN on a shared or public computer.`,
    ``,
    `NEED HELP?`,
    `Your relationship manager ${v.rmName}${v.rmPhone ? ` is on ${v.rmPhone}` : ""}${v.rmEmail ? ` / ${v.rmEmail}` : ""}`,
    ``,
    `Niyom Wealth will never ask you for your password or your 6-digit code.`,
    ``,
    emailFooterText({ year: new Date().getFullYear(), ref: v.dsaCode, notice: NOTICE_RECIPIENT }),
  ].join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Caller must be an active employee ---------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user: caller } } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const { data: emp } = await admin
      .from("nw_employees")
      .select("id, role, full_name, phone, email")
      .eq("auth_user_id", caller.id)
      .eq("status", "active")
      .maybeSingle();
    if (!emp) return json({ error: "Unauthorized" }, 403);

    const isAdmin = emp.role === "admin" || emp.role === "super_admin";

    const body = await req.json().catch(() => ({}));
    const dsaId = String(body?.dsa_id ?? "").trim();
    if (!dsaId) return json({ error: "Missing dsa_id" }, 400);

    // --- Resolve the partner, with the same ownership rule as enabling ------
    const { data: dsa } = await admin
      .from("nw_dsa")
      .select("id, dsa_code, full_name, email, pan, status, employee_id, dsa_login_enabled, dsa_auth_user_id")
      .eq("id", dsaId)
      .maybeSingle();
    if (!dsa) return json({ error: "Partner not found" }, 404);

    if (!isAdmin && dsa.employee_id !== emp.id) {
      return json({ error: "You can only email your own partners." }, 403);
    }

    // --- Refuse to promise access that does not exist ----------------------
    if (!dsa.dsa_login_enabled || !dsa.dsa_auth_user_id) {
      return json({
        error: "Enable this partner's login first — the sign-in steps in this email would not work yet.",
        code: "login_not_enabled",
      }, 409);
    }
    if (dsa.status !== "active") {
      return json({ error: "This partner is inactive." }, 409);
    }
    if (!dsa.email || !isValidEmail(dsa.email)) {
      return json({ error: "This partner has no valid email address on record." }, 400);
    }

    // The RM shown in the email is the DSA's assigned employee, not whoever
    // happened to click the button (an admin may send on their behalf).
    let rm = { full_name: emp.full_name as string, phone: emp.phone as string, email: emp.email as string };
    if (dsa.employee_id) {
      const { data: owner } = await admin
        .from("nw_employees")
        .select("full_name, phone, email")
        .eq("id", dsa.employee_id)
        .maybeSingle();
      if (owner) rm = owner as typeof rm;
    }

    const vars: Vars = {
      partnerName: dsa.full_name,
      dsaCode: dsa.dsa_code,
      pan: String(dsa.pan ?? "").toUpperCase(),
      rmName: rm.full_name ?? "your relationship manager",
      rmPhone: rm.phone ?? "",
      rmEmail: rm.email ?? "",
    };

    const result = await sendEmail({
      apiKey: RESEND_API_KEY,
      to: dsa.email,
      subject: "Your Niyom Wealth Partner Portal access is ready",
      html: buildHtml(vars),
      text: buildText(vars),
    });

    if (!result.ok) {
      console.error("send-partner-welcome-email Resend error:", result.error);
      await admin.from("nw_dsa_login_audit").insert({
        dsa_id: dsaId, action: "welcome_email_failed", actor: "employee",
        metadata: { by_employee_id: emp.id, to: dsa.email },
      });
      return json({ error: "Could not send the email. Please try again." }, 502);
    }

    await admin.from("nw_dsa_login_audit").insert({
      dsa_id: dsaId, action: "welcome_email_sent", actor: "employee",
      metadata: { by_employee_id: emp.id, to: dsa.email, message_id: result.id },
    });

    return json({ success: true, to: dsa.email });
  } catch (err) {
    console.error("send-partner-welcome-email error:", (err as Error)?.message);
    return json({ error: "Internal server error" }, 500);
  }
});
