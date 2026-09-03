import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Transfer / Deal Closure — orchestration edge function.
//
// Responsibilities (per approved Phase 2 principles):
//   1. Authenticate the caller (JWT) and authorise as admin/super_admin.
//   2. Call the atomic RPC nw_transfer_deal(deal_id, admin_id, remarks)
//      — the RPC is the single point of DB truth; it locks the deal,
//        re-verifies eligibility, snapshots business values, inserts the
//        transaction, appends the audit event.
//   3. On successful commit, fire the closure email (best-effort).
//   4. If email delivery fails, record a 'closure_email_failed' event —
//      the transfer itself is NEVER rolled back on email failure.
//
// Notes:
//   - The RPC is REVOKEd from authenticated and GRANTed only to service_role,
//     so this edge function is the only path that can reach it.
//   - Idempotent: re-invocation on the same deal returns the existing
//     transaction ids without duplication.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Stamped into the snapshot + audit metadata so we can trace which
// application build minted a given transfer reference.
const APPLICATION_VERSION = "niyom-crm/transfer-v1 (phase-3)";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Trim + strip angle brackets to defuse the most obvious HTML-injection
// attempts through the audit metadata. The RPC also stores this in the
// event log, which is currently read-only from the app layer, but this is
// cheap defence in depth.
function sanitiseRemarks(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const cleaned = s.replace(/[<>]/g, "").trim().slice(0, 500);
  return cleaned.length ? cleaned : null;
}

// Map raw Postgres errors from the RPC to friendly, actionable messages.
function mapRpcError(err: { code?: string; message?: string; details?: string } | null): { message: string; status: number } {
  const code = err?.code ?? "";
  const msg  = err?.message ?? "";

  // Unique-index violation on the safety net = someone else transferred first.
  if (code === "23505" && (msg.includes("uq_nw_transactions_deal") || msg.includes("deal_confirmation_id"))) {
    return { message: "This deal has already been transferred. Please reload the list.", status: 409 };
  }
  if (code === "42501" || msg.includes("Not authorised")) {
    return { message: "Only administrators can approve a transfer.", status: 403 };
  }
  if (msg.includes("rejected or expired deal cannot be transferred")) {
    return { message: "This deal was rejected or expired and cannot be transferred.", status: 409 };
  }
  if (msg.includes("Deal is no longer accepted")) {
    return { message: "This deal has not been accepted by the client yet. Use the admin override to transfer it without a signature (payment is still required).", status: 409 };
  }
  if (msg.includes("Deal is not fully paid")) {
    return { message: "Deal is no longer eligible — the payment ledger has changed. Please reload.", status: 409 };
  }
  if (msg.includes("Transfer is not enabled for product_type")) {
    return { message: msg.replace(/\s+in v1\.$/, "."), status: 400 };
  }
  if (msg.includes("Unsupported transaction_type")) {
    return { message: "Deal's transaction type is not supported for transfer.", status: 400 };
  }
  if (code === "23503" || msg.includes("Deal") && msg.includes("not found")) {
    return { message: "Deal not found.", status: 404 };
  }
  return { message: msg || "Could not complete transfer.", status: 500 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

    // 1. Authenticate the caller against Supabase Auth
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

    // 2. Resolve caller's employee row and enforce admin role
    const db = createClient(supabaseUrl, serviceKey);
    const { data: employee } = await db
      .from("nw_employees")
      .select("id, role, status, full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!employee || employee.status !== "active") {
      return json({ success: false, error: "Unauthorized" }, 401);
    }
    if (employee.role !== "admin" && employee.role !== "super_admin") {
      return json({ success: false, error: "Only administrators can approve a transfer." }, 403);
    }

    // 3. Parse + validate the request body
    const body = await req.json().catch(() => ({}));
    const dealId = typeof body?.dealId === "string" ? body.dealId : null;
    const remarks = sanitiseRemarks(body?.remarks);
    // Admin override: transfer a PAID deal into MIS without the client's digital
    // acceptance. Payment is still enforced by the RPC. Admin role already
    // checked above, so this flag only reaches the RPC from an authorised admin.
    const overrideAcceptance = body?.override === true;
    // Optional transfer date (the admin may back-date a late review). Accept only
    // a parseable date; anything else falls back to now() inside the RPC (NULL).
    let transferredAt: string | null = null;
    if (typeof body?.transferredAt === "string" && body.transferredAt.trim()) {
      const t = new Date(body.transferredAt);
      if (!Number.isNaN(t.getTime())) transferredAt = t.toISOString();
    }

    if (!dealId) return json({ success: false, error: "dealId is required." }, 400);

    // 4. Call the atomic Transfer RPC. The RPC is the trust boundary for
    //    the actual state transition; it re-verifies everything under
    //    FOR UPDATE and returns idempotent results on re-invocation.
    const { data: rpcResult, error: rpcErr } = await db.rpc("nw_transfer_deal", {
      p_deal_id:             dealId,
      p_admin_id:            employee.id,
      /*
       * `p_remarks text` has no DEFAULT, so the type generator marks it
       * required — but Postgres accepts NULL for it, and NULL is the real
       * "no remarks given" value. Passing '' instead would silently store an
       * empty string, so the cast is deliberate.
       */
      p_remarks:             remarks as string,
      p_app_version:         APPLICATION_VERSION,
      p_override_acceptance: overrideAcceptance,
      // Optional; NULL/undefined → the RPC defaults to now().
      p_transferred_at:      transferredAt ?? undefined,
    });

    if (rpcErr || !rpcResult) {
      console.error("nw_transfer_deal error:", rpcErr);
      const { message, status } = mapRpcError(rpcErr as any);
      return json({ success: false, error: message }, status);
    }

    // Cast RPC jsonb payload
    const result = rpcResult as {
      transaction_id:      string;
      transfer_audit_id:   string | null;
      transfer_reference:  string;
      idempotent:          boolean;
      transferred_at:      string;
      acceptance_overridden?: boolean;
    };

    // 5. Best-effort closure email. Never rolls back the transfer.
    //    While the send-deal-closure-email function may not be deployed yet
    //    (Phase 5), we still attempt the call and record failures cleanly.
    let emailStatus: "sent" | "failed" | "skipped" = "skipped";
    let emailError: string | null = null;
    let emailProviderId: string | null = null;

    // Skip the email hop entirely for idempotent replays — the client
    // already received the closure email on the first run.
    if (!result.idempotent) {
      try {
        const emailResp = await fetch(`${supabaseUrl}/functions/v1/send-deal-closure-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": serviceKey,
          },
          body: JSON.stringify({
            dealId,
            transactionId:     result.transaction_id,
            transferReference: result.transfer_reference,
          }),
        });
        const emailBody = await emailResp.json().catch(() => ({}));
        if (emailResp.ok && emailBody?.success) {
          emailStatus     = "sent";
          emailProviderId = emailBody?.email_id ?? null;
        } else {
          emailStatus = "failed";
          emailError  = emailBody?.error ?? `HTTP ${emailResp.status}`;
        }
      } catch (e: any) {
        emailStatus = "failed";
        emailError  = e?.message ?? String(e);
      }

      // On email failure, record an audit event (fire-and-forget). Never
      // affects the transfer's success.
      if (emailStatus === "failed") {
        try {
          await db.from("nw_deal_confirmation_events").insert({
            deal_id:    dealId,
            event_type: "closure_email_failed",
            actor:      "system",
            metadata: {
              transaction_id:    result.transaction_id,
              transfer_audit_id: result.transfer_audit_id,
              error:             emailError,
            },
          });
        } catch (evtErr) {
          console.error("closure_email_failed audit insert failed:", evtErr);
        }
      }
    }

    return json({
      success:            true,
      transaction_id:     result.transaction_id,
      transfer_audit_id:  result.transfer_audit_id,
      transfer_reference: result.transfer_reference,
      transferred_at:     result.transferred_at,
      idempotent:         result.idempotent,
      acceptance_overridden: result.acceptance_overridden ?? false,
      email_status:       emailStatus,
      email_provider_id:  emailProviderId,
      email_error:        emailError,
    });
  } catch (err: any) {
    console.error("transfer-deal error:", err?.message);
    return json({ success: false, error: err?.message || "Internal error." }, 500);
  }
});
