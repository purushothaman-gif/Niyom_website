import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Records a payment against an ACCEPTED deal. Authenticated employees may
// only record against deals they own; admins/super_admins may record on any.
//
// Atomicity: the actual write is delegated to the SECURITY DEFINER RPC
// `nw_insert_payment(jsonb)`, which serialises concurrent inserts for the
// same deal under a FOR UPDATE lock and allocates the payment_number in the
// SAME transaction as the INSERT. Audit events are emitted by the AFTER
// INSERT trigger `trg_nw_payment_audit_after_insert` on nw_deal_payments,
// so no matter how a payment enters the table (this function, PostgREST,
// psql, or a future gateway webhook) the audit trail is never bypassed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_MODES = new Set([
  "imps", "neft", "rtgs", "upi", "cheque", "cash",
  "bank_transfer", "online_gateway", "demand_draft", "internal_adjustment",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Map a Postgres error thrown by the RPC into a user-facing message.
// Unique-index violations are 23505; we distinguish by constraint name so
// the client sees "UTR already recorded" instead of raw SQL text.
function mapPgError(err: { code?: string; message?: string; details?: string } | null): string {
  if (!err) return "Could not record payment.";
  const code = err.code || "";
  const msg  = err.message || "";
  const det  = err.details || "";

  if (code === "23505") {
    if (msg.includes("uq_nw_deal_payments_utr_per_deal") || det.includes("uq_nw_deal_payments_utr_per_deal")) {
      return "This UTR is already recorded on this deal.";
    }
    if (msg.includes("payment_number") || det.includes("payment_number")) {
      // Should be impossible under the FOR UPDATE lock; surfaced as a safeguard.
      return "Payment number collision. Please retry.";
    }
    if (msg.includes("uq_nw_deal_payments_provider_txn") || det.includes("uq_nw_deal_payments_provider_txn")) {
      return "This gateway transaction has already been recorded.";
    }
    return "Duplicate record. Please review and retry.";
  }
  if (code === "23514") {
    // CHECK violation — most common expected cause here is chk_refund_has_source
    // if a negative amount ever slips past the edge-function guard.
    return "Payment failed a validation rule. Please review the entered details.";
  }
  if (code === "23503") {
    return "Deal not found or has been removed.";
  }
  return msg || "Could not record payment.";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
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
      .select("id, role, status")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!employee || employee.status !== "active") {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const {
      dealId,
      amount,
      currency,
      fxRateToInr,
      paymentMode,
      paymentDate,
      valueDate,
      utrNumber,
      chequeNumber,
      chequeBank,
      chequeDated,
      demandDraftNumber,
      receivedFromName,
      receivedFromBank,
      remarks,
    } = body || {};

    // --- Validation ------------------------------------------------------
    if (!dealId) return json({ success: false, error: "dealId is required." }, 400);

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) {
      return json({ success: false, error: "Amount must be a non-zero number." }, 400);
    }
    // Refunds (negative amounts) are Phase 4; reject cleanly in Phase 1
    // so the user does not hit the chk_refund_has_source CHECK with a
    // cryptic error.
    if (amt < 0) {
      return json(
        { success: false, error: "Refunds are not enabled yet. Please contact your administrator." },
        400
      );
    }

    const curr = String(currency || "INR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(curr)) {
      return json({ success: false, error: "Invalid currency code." }, 400);
    }
    if (curr !== "INR" && !(Number(fxRateToInr) > 0)) {
      return json({ success: false, error: "fxRateToInr is required for non-INR currency." }, 400);
    }

    if (!ALLOWED_MODES.has(paymentMode)) {
      return json({ success: false, error: "Invalid payment mode." }, 400);
    }
    if (!paymentDate) return json({ success: false, error: "paymentDate is required." }, 400);

    if (paymentMode === "cheque" && (!chequeNumber || !chequeBank)) {
      return json({ success: false, error: "Cheque number and bank are required for cheque payments." }, 400);
    }

    // --- Deal + ownership -----------------------------------------------
    const { data: deal } = await db
      .from("nw_deal_confirmations")
      .select("id, employee_id, acceptance_status, settlement_amount, confirmation_number")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal) return json({ success: false, error: "Deal not found." }, 404);
    // Payments may be recorded before the client digitally accepts — some
    // clients stay out of reach yet pay, and that payment must be captured so
    // the deal can later be transferred (admin override). Only rejected/expired
    // deals are closed to new payments.
    // Acceptance is not part of the payment flow. Only a client-REJECTED deal is
    // closed to payments; 'expired' (a timed-out acceptance link) is still a live
    // deal and must accept payments.
    if (deal.acceptance_status === "rejected") {
      return json({ success: false, error: "Payments cannot be recorded on a rejected deal." }, 409);
    }
    const isAdmin = employee.role === "admin" || employee.role === "super_admin";
    if (!isAdmin && deal.employee_id !== employee.id) {
      return json({ success: false, error: "Forbidden" }, 403);
    }

    // --- Pre-check: friendly duplicate-UTR message ---------------------
    // The DB partial unique index is the true guard (safe under races).
    // This lookup only exists to serve a nicer error in the common case.
    if (utrNumber) {
      const { data: dup } = await db
        .from("nw_deal_payments")
        .select("id, payment_number")
        .eq("deal_confirmation_id", dealId)
        .eq("utr_number", utrNumber)
        .eq("status", "active")
        .maybeSingle();
      if (dup) {
        return json(
          { success: false, error: `This UTR is already recorded on this deal (${dup.payment_number}).` },
          409
        );
      }
    }

    // --- Atomic insert via RPC (payment_number allocation + INSERT + audit
    //     trigger all in one transaction under a deal-row FOR UPDATE lock)
    const rpcPayload = {
      deal_confirmation_id:  dealId,
      amount:                amt,
      currency:              curr,
      fx_rate_to_inr:        curr === "INR" ? null : String(Number(fxRateToInr)),
      direction:             "inflow",
      payment_mode:          paymentMode,
      utr_number:            utrNumber ?? null,
      cheque_number:         chequeNumber ?? null,
      cheque_bank:           chequeBank ?? null,
      cheque_dated:          chequeDated ?? null,
      demand_draft_number:   demandDraftNumber ?? null,
      payment_date:          paymentDate,
      value_date:            valueDate ?? null,
      received_by:           employee.id,
      received_from_name:    receivedFromName ?? "",
      received_from_bank:    receivedFromBank ?? null,
      provider:              "manual",
      remarks:               remarks ?? "",
      created_by:            employee.id,
      updated_by:            employee.id,
    };

    const { data: inserted, error: rpcErr } = await db.rpc("nw_insert_payment", { p_data: rpcPayload });
    if (rpcErr || !inserted) {
      console.error("nw_insert_payment error:", rpcErr);
      const friendly = mapPgError(rpcErr as any);
      // 409 for duplicate-ish; 500 otherwise
      const status = (rpcErr as any)?.code === "23505" ? 409 : 500;
      return json({ success: false, error: friendly }, status);
    }

    // Audit events (payment_recorded, outstanding_updated,
    // optional payment_completed) are written by the AFTER INSERT trigger.
    // Nothing to do here except return the fresh summary for the UI.
    const { data: summary } = await db
      .from("nw_deal_payment_summary")
      .select("deal_amount, total_paid_amount, outstanding_amount, payment_status")
      .eq("deal_id", dealId)
      .maybeSingle();

    return json({
      success: true,
      payment: {
        id:             (inserted as any).id,
        payment_number: (inserted as any).payment_number,
        amount_inr:     (inserted as any).amount_inr,
      },
      summary,
    });
  } catch (err: any) {
    console.error("record-payment error:", err?.message);
    return json({ success: false, error: err?.message || "Internal error." }, 500);
  }
});
