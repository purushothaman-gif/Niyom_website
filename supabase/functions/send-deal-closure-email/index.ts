import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  pickCase, subjectFor, renderText, renderHtml,
  type ClosureContext, type LedgerRow,
} from "../_shared/closure_templates.ts";

// Sends the "deal successfully closed" acknowledgement to the client.
//
// Two invocation paths:
//   1. INTERNAL — called by transfer-deal immediately after a successful
//      atomic RPC commit. Authorization: Bearer <service_role_key>.
//   2. RETRY    — called directly from the Transfer Queue success screen
//      by an admin when the first attempt failed. Authorization: caller JWT.
//
// Template selection is derived from the live ledger + prior email log at
// send time. Admin never picks. See _shared/closure_templates.ts.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200): Response {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

    // Path discriminator: exact-match against the service role key means the
    // call originated from transfer-deal (internal). Anything else must be
    // an admin JWT and is validated.
    const isInternalCall = authHeader === `Bearer ${serviceKey}`;

    const db = createClient(supabaseUrl, serviceKey);

    let callerEmployeeId: string | null = null;
    if (!isInternalCall) {
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await callerClient.auth.getUser();
      if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

      const { data: emp } = await db
        .from("nw_employees")
        .select("id, role, status")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (!emp || emp.status !== "active" ||
          (emp.role !== "admin" && emp.role !== "super_admin")) {
        return json({ success: false, error: "Admin role required." }, 403);
      }
      callerEmployeeId = emp.id;
    }

    const body = await req.json().catch(() => ({}));
    const dealId = typeof body?.dealId === "string" ? body.dealId : null;
    if (!dealId) return json({ success: false, error: "dealId is required." }, 400);

    // --- Resolve deal ---------------------------------------------------
    const { data: deal } = await db
      .from("nw_deal_confirmations")
      .select("id, employee_id, snap_client_name, snap_email, confirmation_number, transaction_type")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal) return json({ success: false, error: "Deal not found." }, 404);
    if (!isValidEmail(deal.snap_email)) {
      return json({ success: false, error: "Client email is missing or invalid." }, 400);
    }

    // --- Resolve linked transaction — must be transferred ---------------
    const { data: txn } = await db
      .from("nw_transactions")
      .select("id, transfer_stage, transferred_at, transfer_reference")
      .eq("deal_confirmation_id", dealId)
      .maybeSingle();

    if (!txn || txn.transfer_stage !== "transferred") {
      return json(
        { success: false, error: "This deal has not been transferred yet." },
        409
      );
    }

    // --- Ledger summary + full active payment list ---------------------
    const [summaryRes, paymentsRes] = await Promise.all([
      db.from("nw_deal_payment_summary")
        .select("deal_amount, total_paid_amount, payment_count, last_payment_at")
        .eq("deal_id", dealId).maybeSingle(),
      db.from("nw_deal_payments")
        .select("payment_number, payment_date, payment_mode, utr_number, cheque_number, amount_inr")
        .eq("deal_confirmation_id", dealId)
        .eq("status", "active")
        .order("payment_date", { ascending: true }),
    ]);

    const summary = summaryRes.data as {
      deal_amount: number; total_paid_amount: number;
      payment_count: number; last_payment_at: string | null;
    } | null;
    if (!summary) return json({ success: false, error: "Could not read payment summary." }, 500);

    const ledger = (paymentsRes.data ?? []) as LedgerRow[];

    // --- Was there a prior payment_reminder? (determines dues case) ----
    const { data: priorReminder } = await db
      .from("nw_deal_email_log")
      .select("id")
      .eq("deal_confirmation_id", dealId)
      .eq("email_type", "payment_reminder")
      .eq("status", "sent")
      .limit(1)
      .maybeSingle();

    const caseKind = pickCase(summary.payment_count, !!priorReminder);
    // SELL: money flowed Niyom → client, so the closure copy reads "sale
    // executed / remitted" instead of "investment / received".
    const isSell = String(deal.transaction_type || "").trim().toLowerCase() === "sell";

    // --- Assemble context + render ------------------------------------
    const ctx: ClosureContext = {
      clientName:         deal.snap_client_name || "Client",
      confirmationNumber: deal.confirmation_number,
      transferReference:  txn.transfer_reference ?? "",
      dealAmount:         Number(summary.deal_amount),
      totalPaid:          Number(summary.total_paid_amount),
      paymentCount:       summary.payment_count,
      latestPaymentDate:  summary.last_payment_at,
      ledger,
      transferredAt:      txn.transferred_at,
      year:               new Date().getFullYear(),
      isSell,
    };

    const subject = subjectFor(caseKind, deal.confirmation_number, isSell);
    const text    = renderText(caseKind, ctx);
    const html    = renderHtml(caseKind, ctx);

    // --- Build recipient list -----------------------------------------
    const adminEmail = Deno.env.get("NIYOM_ADMIN_EMAIL") ?? "purushothaman@niyomwealth.com";
    let ownerEmail: string | null = null;
    if (deal.employee_id) {
      const { data: owner } = await db.from("nw_employees")
        .select("email").eq("id", deal.employee_id).maybeSingle();
      ownerEmail = owner?.email ?? null;
    }
    const clientTo = deal.snap_email.trim();
    const cc = buildCc([ownerEmail, adminEmail], clientTo);

    // Is this a resend of the same email_type on this deal?
    const { data: prior } = await db
      .from("nw_deal_email_log")
      .select("id")
      .eq("deal_confirmation_id", dealId)
      .eq("email_type", "deal_closure")
      .limit(1)
      .maybeSingle();
    const isResend = !!prior;

    // --- Send via Resend ----------------------------------------------
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Niyom Wealth <support@niyomwealth.com>",
        to: [clientTo],
        ...(cc.length ? { cc } : {}),
        subject, text, html,
      }),
    });

    const respBody = await resendResp.json().catch(() => ({} as any));

    // --- Append email-log row (append-only audit) ----------------------
    const logRow = {
      deal_confirmation_id: dealId,
      email_type: "deal_closure",
      sent_to: clientTo,
      cc_recipients: cc,
      sent_by: callerEmployeeId,   // NULL when the call is internal (system)
      is_resend: isResend,
      status: resendResp.ok ? "sent" : "failed",
      provider_message_id: resendResp.ok ? (respBody?.id ?? null) : null,
      metadata: {
        case_kind:           caseKind,
        transfer_reference:  txn.transfer_reference,
        transaction_id:      txn.id,
        payment_count:       summary.payment_count,
        total_paid_amount:   summary.total_paid_amount,
        transferred_at:      txn.transferred_at,
        invocation:          isInternalCall ? "internal" : "admin_retry",
        subject,
        ...(resendResp.ok ? {} : { error: respBody?.message ?? "send failed" }),
      },
    };
    try { await db.from("nw_deal_email_log").insert(logRow); }
    catch (e) { console.error("closure email log insert failed:", e); }

    if (!resendResp.ok) {
      console.error("resend error (deal_closure):", respBody);
      return json({ success: false, error: respBody?.message || "Failed to send closure email." }, 502);
    }

    // --- Audit event ---------------------------------------------------
    try {
      await db.from("nw_deal_confirmation_events").insert({
        deal_id: dealId,
        event_type: "closure_emailed",
        actor: isInternalCall ? "system" : "employee",
        metadata: {
          case_kind:            caseKind,
          transfer_reference:   txn.transfer_reference,
          transaction_id:       txn.id,
          provider_message_id:  respBody?.id ?? null,
          to:                   clientTo,
          cc,
          is_resend:            isResend,
          invocation:           isInternalCall ? "internal" : "admin_retry",
          sent_by:              callerEmployeeId,
        },
      });
    } catch (e) { console.error("closure_emailed audit insert failed:", e); }

    return json({
      success:            true,
      case_kind:          caseKind,
      email_id:           respBody?.id ?? null,
      is_resend:          isResend,
      transfer_reference: txn.transfer_reference,
    });
  } catch (err: any) {
    console.error("send-deal-closure-email error:", err?.message);
    return json({ success: false, error: err?.message || "Internal error." }, 500);
  }
});
