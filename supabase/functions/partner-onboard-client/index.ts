import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders, json, serviceClient, NIYOM_DEFAULT_EMPLOYEE_ID,
  normalizePhone, isValidPhone, isValidEmail, isValidPan,
} from "../_shared/onboarding.ts";
import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from "../_shared/email_footer.ts";

// partner-onboard-client — a logged-in PARTNER (DSA) creates one of their own
// clients, so the RM no longer has to key it in. Runs public (verify_jwt=false)
// but authenticates INSIDE: requires the partner's own bearer + is_partner, then
// re-reads nw_dsa from the auth user (login-enabled + active) — JWT metadata is
// never trusted. The client is filed under the partner's RM (dsa.employee_id) with
// an auto-generated client_code in that RM's series, and mapped to the partner
// (dsa_id + sourced_via='dsa' — the pair DSAPayout keys on). Record only: no client
// login is created (the RM enables it later). PAN was verified before submit via the
// public PAN gate (public-onboard-pan-verify), the same as client self-onboarding.

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
    const full_name = String(body.full_name || "").trim();
    const pan = String(body.pan || "").trim().toUpperCase();
    const phone = normalizePhone(String(body.phone || ""));
    const email = String(body.email || "").trim().toLowerCase();
    const prefsRaw = Array.isArray(body.investment_preferences) ? body.investment_preferences : [];
    const investment_preferences = prefsRaw
      .map((p: unknown) => String(p || "").trim())
      .filter((p: string) => p.length > 0)
      .slice(0, 8);

    if (!full_name) return json({ error: "Client name is required." }, 400);
    if (!isValidPan(pan)) return json({ error: "Enter a valid PAN (e.g. ABCDE1234F)." }, 400);
    if (!isValidPhone(phone)) return json({ error: "Enter a valid 10-digit mobile number." }, 400);
    if (!isValidEmail(email)) return json({ error: "Enter a valid email address." }, 400);

    const db = serviceClient();

    // Resolve the DSA from the bearer (must be an enabled, active partner login).
    const { data: dsa } = await db
      .from("nw_dsa")
      .select("id, dsa_code, full_name, email, employee_id, status, dsa_login_enabled")
      .eq("dsa_auth_user_id", user.id)
      .maybeSingle();
    if (!dsa || !dsa.dsa_login_enabled || dsa.status !== "active") {
      return json({ error: "Partner access required." }, 403);
    }

    // Dedupe — a client can't be created twice. Separate equality queries avoid
    // interpolating an email (which may contain a comma) into an .or() filter.
    const [{ data: byPan }, { data: byPhone }, { data: byEmail }] = await Promise.all([
      db.from("nw_clients").select("id").eq("pan", pan).maybeSingle(),
      db.from("nw_clients").select("id").eq("phone", phone).maybeSingle(),
      db.from("nw_clients").select("id").eq("email", email).maybeSingle(),
    ]);
    if (byPan)   return json({ error: "A client with this PAN already exists." }, 409);
    if (byPhone) return json({ error: "A client with this mobile number already exists." }, 409);
    if (byEmail) return json({ error: "A client with this email already exists." }, 409);

    // The client is owned by the partner's RM; fall back to the house account when
    // a partner has no RM mapped (employee_id is nullable in production).
    const ownerEmployeeId = dsa.employee_id ?? NIYOM_DEFAULT_EMPLOYEE_ID;

    const { data: clientCode, error: codeErr } = await db.rpc("nw2_generate_client_code", {
      p_employee_id: ownerEmployeeId,
    });
    if (codeErr) throw codeErr;

    const { data: client, error: clientErr } = await db.from("nw_clients").insert([{
      client_code: clientCode,
      employee_id: ownerEmployeeId,
      full_name,
      email,
      phone,
      // PAN verified up front via public-onboard-pan-verify (same gate the client
      // self-onboard flow uses before this record is created).
      pan,
      pan_name: full_name,
      pan_verified: true,
      phone_verified: false,
      verification_status: "pending",
      onboarding_status: "kyc_in_progress",
      // DSA-sourced from the outset — the pairing DSAPayout.tsx keys on.
      sourced_via: "dsa",
      dsa_id: dsa.id,
      // Record only: no login yet. The RM enables it (create-client-login) after KYC.
      client_login_enabled: false,
      client_password_changed: false,
      ...(investment_preferences.length ? { investment_preferences } : {}),
    }]).select("id, client_code").single();
    if (clientErr) throw clientErr;

    await db.from("nw_activity_logs").insert([{
      employee_id: ownerEmployeeId,
      client_id: client.id,
      action: "Client Onboarded by Partner",
      description: `${dsa.full_name || dsa.dsa_code || "A partner"} onboarded ${full_name} (${client.client_code}). KYC pending.`,
    }]);

    try {
      await notifyRm(db, {
        rmId: ownerEmployeeId,
        partnerName: dsa.full_name || dsa.dsa_code || "a partner",
        clientName: full_name,
        clientCode: client.client_code,
        clientEmail: email,
        clientPhone: phone,
        pan,
      });
    } catch (e) {
      console.error("RM partner-onboard-client email failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, client_code: client.client_code, client_id: client.id }, 200);
  } catch (err: any) {
    console.error("partner-onboard-client error:", err?.message);
    return json({ error: err?.message || "Could not onboard the client. Please try again." }, 500);
  }
});

async function notifyRm(
  db: ReturnType<typeof serviceClient>,
  o: { rmId: string; partnerName: string; clientName: string; clientCode: string; clientEmail: string; clientPhone: string; pan: string },
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
  let rmEmail = adminEmail;
  let rmName = "Team";
  const { data: emp } = await db.from("nw_employees").select("full_name, email").eq("id", o.rmId).maybeSingle();
  if (emp?.email) { rmEmail = emp.email; rmName = emp.full_name || rmName; }
  const to = [...new Set([rmEmail, adminEmail].filter(Boolean))];
  const year = new Date().getFullYear();
  const subject = `New client ${o.clientCode} — ${o.clientName} (onboarded by ${o.partnerName})`;

  const text = `Dear ${rmName},

${o.partnerName} (partner) has onboarded a new client mapped under you.

Client:     ${o.clientName}
Code:       ${o.clientCode}
PAN:        ${o.pan}
Mobile:     ${o.clientPhone}
Email:      ${o.clientEmail}

The record is created with PAN verified; KYC (bank, demat, documents) and the
client login are still pending. Open the CRM to complete KYC and enable the login.

Niyom Wealth Distribution LLP

${emailFooterText({ year, ref: o.clientCode, notice: NOTICE_AUTOMATED })}`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Dear ${rmName},</p>
    <p style="margin:0 0 14px;"><strong>${escapeHtml(o.partnerName)}</strong> (partner) has onboarded a new client mapped under you.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:130px;">Client</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(o.clientName)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Code</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(o.clientCode)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">PAN</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(o.pan)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Mobile</td><td style="padding:6px 0;">${escapeHtml(o.clientPhone)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Email</td><td style="padding:6px 0;">${escapeHtml(o.clientEmail)}</td></tr>
    </table>
    <p style="margin:0 0 14px;">The record is created with PAN verified; KYC (bank, demat, documents) and the client login are still pending. Open the CRM to complete KYC and enable the login.</p>
    <p style="margin:18px 0 0;color:#111;font-weight:600;">Niyom Wealth Distribution LLP</p>
    ${emailFooterHtml({ year, ref: o.clientCode, notice: NOTICE_AUTOMATED })}
  </div>
</body></html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Niyom Wealth <support@niyomwealth.com>", to, reply_to: o.clientEmail || undefined, subject, html, text }),
  });
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
