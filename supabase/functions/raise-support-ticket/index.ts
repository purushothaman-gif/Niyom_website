import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from "../_shared/email_footer.ts";

// raise-support-ticket — a logged-in wealth-portal client raises a support
// ticket. Runs public (verify_jwt=false) but requires the client's own bearer
// token and verifies ownership of the client record server-side. Inserts the
// ticket with the service role (which also fires the nw_notify_rm_on_ticket
// trigger → in-app CRM alert) and then emails the assigned RM (best-effort).

const CATEGORIES = new Set(["general", "transaction", "kyc", "bank", "technical", "feedback"]);

const CATEGORY_LABEL: Record<string, string> = {
  general: "General enquiry",
  transaction: "Transaction / order",
  kyc: "KYC / verification",
  bank: "Bank account",
  technical: "Technical / login",
  feedback: "Feedback",
};

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
    const client_id = (body.client_id || "").trim();
    const category = CATEGORIES.has(body.category) ? body.category : "general";
    const subject = (body.subject || "").trim().slice(0, 160);
    const message = (body.message || "").trim().slice(0, 4000);

    if (!client_id) return json({ error: "Missing client." }, 400);
    if (!subject) return json({ error: "Please add a subject." }, 400);
    if (!message) return json({ error: "Please add a message." }, 400);

    const db = serviceClient();
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, email, phone, employee_id, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);

    // Insert the ticket (fires the in-app RM alert trigger).
    const { data: ticket, error: insErr } = await db
      .from("nw_support_tickets")
      .insert({ client_id, category, subject, message })
      .select("id, ref, category, subject, message, status, priority, created_at, updated_at")
      .single();
    if (insErr) throw insErr;

    // Email the assigned RM (best-effort — never blocks the ticket).
    try {
      await notifyRm(db, client, ticket);
    } catch (e) {
      console.error("RM ticket email failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, ticket }, 200);
  } catch (err: any) {
    console.error("raise-support-ticket error:", err?.message);
    return json({ error: err?.message || "Could not raise your ticket. Please try again." }, 500);
  }
});

async function notifyRm(
  db: ReturnType<typeof serviceClient>,
  client: { full_name: string; client_code: string; email: string | null; phone: string | null; employee_id: string | null },
  ticket: { ref: string; category: string; subject: string; message: string },
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
  // De-dupe recipients (RM + admin fallback).
  const to = [...new Set([rmEmail, adminEmail].filter(Boolean))];

  const year = new Date().getFullYear();
  const catLabel = CATEGORY_LABEL[ticket.category] ?? ticket.category;
  const subject = `New support ticket ${ticket.ref} — ${client.full_name} (${client.client_code})`;
  const contact = [client.email, client.phone].filter(Boolean).join(" · ") || "—";

  const text = `Dear ${rmName},

${client.full_name} (Client Code ${client.client_code}) has raised a support ticket from the wealth portal.

Ref:      ${ticket.ref}
Category: ${catLabel}
Subject:  ${ticket.subject}
Contact:  ${contact}

Message:
${ticket.message}

Open the CRM → Support Tickets to respond and update its status.

Niyom Wealth Distribution LLP

${emailFooterText({ year, ref: ticket.ref, notice: NOTICE_AUTOMATED })}`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#ffffff;">
    <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;border-bottom:2px solid #D4AF37;padding-bottom:14px;">Niyom Wealth</div>
    <p style="margin:0 0 14px;">Dear ${rmName},</p>
    <p style="margin:0 0 14px;"><strong>${client.full_name}</strong> (Client Code <strong>${client.client_code}</strong>) has raised a support ticket from the wealth portal.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:110px;">Ref</td><td style="padding:6px 0;font-weight:600;">${ticket.ref}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Category</td><td style="padding:6px 0;">${catLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Subject</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(ticket.subject)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Contact</td><td style="padding:6px 0;">${escapeHtml(contact)}</td></tr>
    </table>
    <div style="background:#f6f6f6;border-radius:8px;padding:14px 16px;margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(ticket.message)}</div>
    <p style="margin:0 0 14px;">Open the CRM → <strong>Support Tickets</strong> to respond and update its status.</p>
    <p style="margin:18px 0 0;color:#111;font-weight:600;">Niyom Wealth Distribution LLP</p>
    ${emailFooterHtml({ year, ref: ticket.ref, notice: NOTICE_AUTOMATED })}
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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
