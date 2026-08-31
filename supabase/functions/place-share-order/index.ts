import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { notifyRmOfShareOrder } from "../_shared/share_order_email.ts";

// place-share-order — a logged-in wealth-portal client places an unlisted share
// order by quantity. Runs public (verify_jwt=false) but requires the client's own
// bearer token and verifies ownership server-side. The PRICE IS RE-DERIVED HERE
// (base latest_price × the client's approved markup) — a client-sent price is
// never trusted, and the base price never leaves the server. Inserts with the
// service role (firing nw_notify_rm_on_share_order → in-app CRM alert), then
// emails the assigned RM (best-effort).

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
    if (!user || user.user_metadata?.is_client !== true) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const client_id = String(body.client_id || "").trim();
    const share_id = String(body.share_id || "").trim();
    const qty = Number.parseInt(String(body.qty ?? ""), 10);
    const notes = String(body.notes || "").trim().slice(0, 1000);

    if (!client_id) return json({ error: "Missing client." }, 400);
    if (!share_id) return json({ error: "Missing share." }, 400);
    if (!Number.isInteger(qty) || qty <= 0) return json({ error: "Enter a valid quantity." }, 400);

    const db = serviceClient();

    // Ownership: this bearer must own this client record.
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, email, phone, employee_id, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);

    const { data: share } = await db
      .from("us_shares")
      .select("id, isin, company_name, latest_price, lot_size, min_qty, active_status")
      .eq("id", share_id)
      .maybeSingle();
    if (!share || share.active_status !== "active" || share.latest_price == null) {
      return json({ error: "This share is not available." }, 404);
    }

    // Re-derive the client price server-side (approved markup only — no default).
    const { data: markup, error: mErr } = await db.rpc("us_resolve_markup", {
      p_audience: "client",
      p_client_id: client_id,
      p_dsa_id: null as unknown as string,
      p_employee_id: (client.employee_id ?? null) as unknown as string,
    });
    if (mErr) throw mErr;
    if (markup == null) return json({ error: "This share is not available for your account yet." }, 403);

    const pricePerShare = round2(Number(share.latest_price) * (1 + Number(markup) / 100));

    // Same min/lot rule the UI shows.
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
      await notifyRmOfShareOrder(db, { client, share, order });
    } catch (e) {
      console.error("RM share-order email failed (non-fatal):", (e as any)?.message);
    }

    return json({ success: true, order }, 200);
  } catch (err: any) {
    console.error("place-share-order error:", err?.message);
    return json({ error: err?.message || "Could not place your order. Please try again." }, 500);
  }
});
