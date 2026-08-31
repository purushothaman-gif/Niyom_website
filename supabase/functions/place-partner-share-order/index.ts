import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { notifyRmOfShareOrder } from "../_shared/share_order_email.ts";

// place-partner-share-order — a logged-in PARTNER (DSA) places an unlisted share
// order on behalf of one of their own clients, at the partner's own price. Runs
// public (verify_jwt=false) but requires the partner's bearer + is_partner,
// resolves the DSA from the auth user, and verifies the chosen client belongs to
// that DSA. The PRICE IS RE-DERIVED HERE (cost = base × approved partner rate,
// then × the partner's margin, capped 5%) — never trusted from the caller. The
// order routes to the CLIENT'S RM, not the partner, exactly like a bond order.

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

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
    const client_id = String(body.client_id || "").trim();
    const share_id = String(body.share_id || "").trim();
    const qty = Number.parseInt(String(body.qty ?? ""), 10);
    const margin = Number(body.margin ?? 0);
    const notes = String(body.notes || "").trim().slice(0, 1000);

    if (!client_id) return json({ error: "Choose a client." }, 400);
    if (!share_id) return json({ error: "Missing share." }, 400);
    if (!Number.isInteger(qty) || qty <= 0) return json({ error: "Enter a valid quantity." }, 400);
    if (!Number.isFinite(margin) || margin < 0 || margin > 5) {
      return json({ error: "Your margin must be between 0% and 5%." }, 400);
    }

    const db = serviceClient();

    const { data: dsa } = await db
      .from("nw_dsa")
      .select("id, full_name, email, employee_id, status, dsa_login_enabled")
      .eq("dsa_auth_user_id", user.id)
      .maybeSingle();
    if (!dsa || !dsa.dsa_login_enabled || dsa.status !== "active") return json({ error: "Unauthorized" }, 403);

    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, email, phone, employee_id, dsa_id, sourced_via")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.dsa_id !== dsa.id || client.sourced_via !== "dsa") {
      return json({ error: "That client isn't mapped to you." }, 403);
    }

    const { data: share } = await db
      .from("us_shares")
      .select("id, isin, company_name, latest_price, lot_size, min_qty, active_status")
      .eq("id", share_id)
      .maybeSingle();
    if (!share || share.active_status !== "active" || share.latest_price == null) {
      return json({ error: "This share is not available." }, 404);
    }

    const { data: rate, error: rErr } = await db.rpc("us_resolve_markup", {
      p_audience: "partner",
      p_client_id: null as unknown as string,
      p_dsa_id: dsa.id,
      p_employee_id: (dsa.employee_id ?? null) as unknown as string,
    });
    if (rErr) throw rErr;
    if (rate == null) return json({ error: "Share pricing isn't approved for you yet." }, 403);

    const costPerShare = Number(share.latest_price) * (1 + Number(rate) / 100);
    const pricePerShare = round2(costPerShare * (1 + margin / 100));

    const minQty = Math.max(1, Math.round(Number(share.min_qty) || 1));
    const step = Math.max(1, Math.round(Number(share.lot_size) || 1));
    if (qty < minQty || (qty - minQty) % step !== 0) {
      return json({ error: `Quantity must be ${minQty} or more, in steps of ${step}.` }, 400);
    }

    const amount = round2(qty * pricePerShare);

    const { data: order, error: insErr } = await db
      .from("nw_share_orders")
      .insert({
        client_id,
        share_id,
        assigned_employee_id: client.employee_id,
        dsa_id: dsa.id,
        source: "partner",
        partner_markup_percent: margin,
        isin: share.isin || "",
        company_name: share.company_name || "",
        qty,
        price_per_share: pricePerShare,
        amount,
        notes,
      })
      .select("id, ref, qty, price_per_share, amount, status, created_at")
      .single();
    if (insErr) throw insErr;

    try {
      await notifyRmOfShareOrder(db, { client, share, order, partnerName: dsa.full_name });
    } catch (e) {
      console.error("RM partner share-order email failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, order }, 200);
  } catch (err: any) {
    console.error("place-partner-share-order error:", err?.message);
    return json({ error: err?.message || "Could not place the order. Please try again." }, 500);
  }
});
