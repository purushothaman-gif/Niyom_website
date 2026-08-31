import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, serviceClient, NIYOM_DEFAULT_EMPLOYEE_ID } from "../_shared/onboarding.ts";
import { notifyRmOfShareOrder } from "../_shared/share_order_email.ts";

// submit-share-offer — PUBLIC (verify_jwt=false). A recipient of a partner's shared
// unlisted-share link expresses intent to buy. If their contact matches an EXISTING
// client of that DSA, a real order is created (source='partner') at the partner
// price and routed to the client's RM; otherwise a lead is routed to the DSA's RM.
// Either way an RM follows up — a real trade always needs a KYC'd client. The price
// is re-derived server-side; nothing is trusted from the form.

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const fullName = String(body.full_name ?? "").trim().slice(0, 120);
    const mobile = String(body.mobile ?? "").replace(/\D/g, "").slice(0, 15);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 160);
    const qty = Number.parseInt(String(body.qty ?? ""), 10);

    if (!token) return json({ error: "Missing link." }, 400);
    if (fullName.length < 2) return json({ error: "Please enter your name." }, 400);
    if (mobile.length !== 10) return json({ error: "Please enter a valid 10-digit mobile number." }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
    if (!Number.isInteger(qty) || qty <= 0) return json({ error: "Please enter a valid quantity." }, 400);

    const db = serviceClient();

    const { data: link } = await db
      .from("nw_partner_share_links")
      .select("dsa_id, share_id, margin_percent, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!link) return json({ error: "This link is not valid." }, 404);
    if (link.expires_at && new Date(link.expires_at) < new Date()) return json({ error: "This link has expired." }, 410);

    const { data: dsa } = await db
      .from("nw_dsa").select("id, dsa_code, full_name, employee_id, status, dsa_login_enabled")
      .eq("id", link.dsa_id).maybeSingle();
    if (!dsa || dsa.status !== "active" || !dsa.dsa_login_enabled) return json({ error: "This link is no longer active." }, 410);

    const { data: share } = await db
      .from("us_shares")
      .select("id, isin, company_name, latest_price, lot_size, min_qty, active_status")
      .eq("id", link.share_id).maybeSingle();
    if (!share || share.active_status !== "active" || share.latest_price == null) {
      return json({ error: "This share is no longer available." }, 410);
    }

    const { data: rate } = await db.rpc("us_resolve_markup", {
      p_audience: "partner", p_client_id: null as unknown as string,
      p_dsa_id: dsa.id, p_employee_id: (dsa.employee_id ?? null) as unknown as string,
    });
    if (rate == null) return json({ error: "This offer is no longer available." }, 410);

    const pricePerShare = round2(
      Number(share.latest_price) * (1 + Number(rate) / 100) * (1 + Number(link.margin_percent) / 100),
    );
    const ownerEmployee = dsa.employee_id ?? NIYOM_DEFAULT_EMPLOYEE_ID;

    // Does the contact match an existing client of THIS DSA? Then it is a real order.
    let matchQuery = db.from("nw_clients")
      .select("id, employee_id, full_name, client_code, email, phone")
      .eq("dsa_id", dsa.id).eq("sourced_via", "dsa");
    matchQuery = email ? matchQuery.or(`phone.eq.${mobile},email.ilike.${email}`) : matchQuery.eq("phone", mobile);
    const { data: matches } = await matchQuery.limit(1);
    const client = matches && matches.length === 1 ? matches[0] : null;

    if (client) {
      const minQty = Math.max(1, Math.round(Number(share.min_qty) || 1));
      const step = Math.max(1, Math.round(Number(share.lot_size) || 1));
      if (qty < minQty || (qty - minQty) % step !== 0) {
        return json({ error: `Quantity must be ${minQty} or more, in steps of ${step}.` }, 400);
      }
      const amount = round2(qty * pricePerShare);

      const { data: order, error: insErr } = await db.from("nw_share_orders").insert({
        client_id: client.id, share_id: share.id, assigned_employee_id: client.employee_id,
        dsa_id: dsa.id, source: "partner", partner_markup_percent: link.margin_percent,
        isin: share.isin || "", company_name: share.company_name || "", qty,
        price_per_share: pricePerShare, amount,
        notes: `Placed via ${dsa.full_name || "partner"}'s shared link`,
      }).select("id, ref, qty, price_per_share, amount, status, created_at").single();
      if (insErr) throw insErr;

      try {
        await notifyRmOfShareOrder(db, { client, share, order, partnerName: dsa.full_name });
      } catch (e) {
        console.error("RM shared-link share-order email failed (non-fatal):", (e as any)?.message);
      }
      return json({ success: true, outcome: "order", ref: order.ref }, 200);
    }

    // Otherwise route a lead to the DSA's RM, noting the share interest.
    const remarks = `Interested in ${share.company_name || share.isin} — ${qty} share(s) at ₹${pricePerShare}/share (via shared link).`;
    const { data: existingLead } = await db.from("nw_leads")
      .select("id, lead_code").eq("mobile", mobile).eq("is_archived", false).limit(1).maybeSingle();

    let leadCode = existingLead?.lead_code ?? null;
    if (!existingLead) {
      const { data: lead, error: leadErr } = await db.from("nw_leads").insert([{
        lead_name: fullName, mobile, email,
        interested_product: share.company_name || "Unlisted Shares",
        remarks, lead_origin: "partner_portal", lead_source: "Partner / Share Offer",
        campaign: `partner:${dsa.dsa_code}`, status: "New",
        owner_employee_id: ownerEmployee, created_by_employee_id: null, dsa_id: dsa.id,
      }]).select("lead_code").single();
      if (leadErr) throw leadErr;
      leadCode = lead.lead_code;
    }
    try {
      await db.from("nw_activity_logs").insert([{
        employee_id: ownerEmployee,
        action: "Share Offer Enquiry",
        description: `${fullName} (${mobile}) is interested in ${share.company_name || share.isin} via ${dsa.full_name}'s shared link. ${existingLead ? "Existing lead " + leadCode : "Lead " + leadCode}.`,
      }]);
    } catch (_) { /* non-fatal */ }

    return json({ success: true, outcome: "lead", lead_code: leadCode }, 200);
  } catch (err: any) {
    console.error("submit-share-offer error:", err?.message);
    return json({ error: "Could not submit your request. Please try again." }, 500);
  }
});
