import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public function (verify_jwt = false). Resolves a secure deal link, lazily
// marks the deal as viewed/expired, and returns sanitized data for rendering.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fields safe to expose on the public page (no internal notes / employee ids)
function sanitize(deal: Record<string, any>) {
  return {
    confirmation_number: deal.confirmation_number,
    deal_date: deal.deal_date,
    created_at: deal.created_at,
    transaction_type: deal.transaction_type,
    product_type: deal.product_type,
    security_name: deal.security_name,
    isin: deal.isin,
    quantity: deal.quantity,
    rate_per_unit: deal.rate_per_unit,
    stamp_duty: deal.stamp_duty,
    settlement_amount: deal.settlement_amount,
    snap_client_name: deal.snap_client_name,
    snap_pan: deal.snap_pan,
    snap_dp_name: deal.snap_dp_name,
    snap_demat_account: deal.snap_demat_account,
    snap_depository: deal.snap_depository,
    // Client bank snapshot — needed only to print the "remit to" account on a
    // SELL deal note (Niyom pays the client). This is the client's own bank,
    // shown to the client on their own secure-token page.
    snap_bank_name: deal.snap_bank_name,
    snap_bank_account: deal.snap_bank_account,
    snap_bank_ifsc: deal.snap_bank_ifsc,
    acceptance_status: deal.acceptance_status,
    // masked email for display ("jo****@gmail.com")
    client_email_masked: maskEmail(deal.snap_email || ""),
  };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "";
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token || typeof token !== "string") {
      return json({ valid: false, reason: "invalid" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const { data: deal } = await db
      .from("nw_deal_confirmations")
      .select("*")
      .eq("secure_token", token)
      .maybeSingle();

    if (!deal) {
      return json({ valid: false, reason: "invalid" });
    }

    // Terminal states short-circuit
    if (deal.acceptance_status === "accepted") {
      return json({ valid: false, reason: "accepted" });
    }
    if (deal.acceptance_status === "rejected") {
      return json({ valid: false, reason: "rejected" });
    }

    // Expiry check (lazy transition to 'expired')
    if (deal.token_expires_at && new Date(deal.token_expires_at) < new Date()) {
      if (deal.acceptance_status !== "expired") {
        await db.from("nw_deal_confirmations")
          .update({ acceptance_status: "expired" })
          .eq("id", deal.id);
        await db.from("nw_deal_confirmation_events").insert({
          deal_id: deal.id, event_type: "expired", actor: "system",
        });
      }
      return json({ valid: false, reason: "expired" });
    }

    // First open → mark viewed
    if (deal.acceptance_status === "pending") {
      await db.from("nw_deal_confirmations")
        .update({ acceptance_status: "viewed", viewed_at: new Date().toISOString() })
        .eq("id", deal.id);
      await db.from("nw_deal_confirmation_events").insert({
        deal_id: deal.id,
        event_type: "viewed",
        actor: "client",
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        user_agent: req.headers.get("user-agent") ?? undefined,
      });
      deal.acceptance_status = "viewed";
    }

    return json({ valid: true, deal: sanitize(deal) });
  } catch (err: any) {
    console.error("get-deal-by-token error:", err?.message);
    return json({ valid: false, reason: "error" }, 500);
  }
});
