import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";

// submit-bond-offer — PUBLIC (verify_jwt=false). A recipient of a partner's shared
// bond link expresses intent to invest. If their contact matches an EXISTING client
// of that DSA, a real bond order is created (source='partner') at the partner price
// and routed to the client's RM; otherwise a lead is routed to the DSA's RM. Either
// way the RM follows up — a real deal always needs a KYC'd client. The price is
// re-derived server-side; nothing is trusted from the form.

const NIYOM_DEFAULT_EMPLOYEE_ID = "1b543112-3251-4912-847b-92982f2de563";

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n: number): number { return Math.round((n + Number.EPSILON) * 10000) / 10000; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const fullName = String(body.full_name ?? "").trim().slice(0, 120);
    const mobile = String(body.mobile ?? "").replace(/\D/g, "").slice(0, 15);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 160);
    const units = Number.parseInt(String(body.units ?? ""), 10);

    if (!token) return json({ error: "Missing link." }, 400);
    if (fullName.length < 2) return json({ error: "Please enter your name." }, 400);
    if (mobile.length !== 10) return json({ error: "Please enter a valid 10-digit mobile number." }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
    if (!Number.isInteger(units) || units <= 0) return json({ error: "Please enter a valid quantity." }, 400);

    const db = serviceClient();

    const { data: share } = await db
      .from("nw_partner_bond_shares")
      .select("dsa_id, bond_id, margin_percent, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!share) return json({ error: "This link is not valid." }, 404);
    if (share.expires_at && new Date(share.expires_at) < new Date()) return json({ error: "This link has expired." }, 410);

    const { data: dsa } = await db
      .from("nw_dsa").select("id, dsa_code, full_name, employee_id, status, dsa_login_enabled")
      .eq("id", share.dsa_id).maybeSingle();
    if (!dsa || dsa.status !== "active" || !dsa.dsa_login_enabled) return json({ error: "This link is no longer active." }, 410);

    const { data: bond } = await db
      .from("bm_bonds")
      .select("id, isin, bond_name, latest_price, face_value, min_investment, lot_size, active_status, analytics")
      .eq("id", share.bond_id).maybeSingle();
    if (!bond || bond.active_status !== "active" || bond.latest_price == null) return json({ error: "This bond is no longer available." }, 410);

    const { data: rate } = await db.rpc("bm_resolve_markup", {
      p_audience: "partner", p_client_id: null as unknown as string,
      p_dsa_id: dsa.id, p_employee_id: (dsa.employee_id ?? null) as unknown as string,
    });
    if (rate == null) return json({ error: "This offer is no longer available." }, 410);

    const pricePer100 = round4(Number(bond.latest_price) * (1 + Number(rate) / 100) * (1 + Number(share.margin_percent) / 100));
    const ownerEmployee = dsa.employee_id ?? NIYOM_DEFAULT_EMPLOYEE_ID;

    // Does the contact match an existing client of THIS DSA? Then it's a real order.
    let matchQuery = db.from("nw_clients")
      .select("id, employee_id, full_name")
      .eq("dsa_id", dsa.id).eq("sourced_via", "dsa");
    matchQuery = email ? matchQuery.or(`phone.eq.${mobile},email.ilike.${email}`) : matchQuery.eq("phone", mobile);
    const { data: matches } = await matchQuery.limit(1);
    const client = matches && matches.length === 1 ? matches[0] : null;

    if (client) {
      const face = Number(bond.face_value) || 100;
      const minUnits = Math.max(1, Math.ceil((Number(bond.min_investment) || face) / face));
      const stepUnits = Math.max(1, Math.round(Number(bond.lot_size) || 1));
      if (units < minUnits || (units - minUnits) % stepUnits !== 0) {
        return json({ error: `Quantity must be ${minUnits} or more, in steps of ${stepUnits}.` }, 400);
      }
      const analytics = (bond.analytics ?? {}) as Record<string, unknown>;
      const accruedPer100 = Number(analytics.accrued_per_100) || 0;
      const amount = round2(units * face * (pricePer100 / 100) + units * face * (accruedPer100 / 100));

      const { data: order, error: insErr } = await db.from("nw_bond_orders").insert({
        client_id: client.id, bond_id: bond.id, assigned_employee_id: client.employee_id,
        dsa_id: dsa.id, source: "partner", partner_markup_percent: share.margin_percent,
        isin: bond.isin || "", bond_name: bond.bond_name || "", units,
        price_per_100: pricePer100, face_value: face, amount,
        notes: `Placed via ${dsa.full_name || "partner"}'s shared link`,
      }).select("ref").single();
      if (insErr) throw insErr;
      return json({ success: true, outcome: "order", ref: order.ref }, 200);
    }

    // Otherwise route a lead to the DSA's RM, noting the bond interest.
    const remarks = `Interested in ${bond.bond_name || bond.isin} — ${units} unit(s) at ₹${pricePer100}/100 (via shared link).`;
    const { data: existingLead } = await db.from("nw_leads")
      .select("id, lead_code").eq("mobile", mobile).eq("is_archived", false).limit(1).maybeSingle();

    let leadCode = existingLead?.lead_code ?? null;
    if (!existingLead) {
      const { data: lead, error: leadErr } = await db.from("nw_leads").insert([{
        lead_name: fullName, mobile, email, interested_product: bond.bond_name || "Bond",
        remarks, lead_origin: "partner_portal", lead_source: "Partner / Bond Offer",
        campaign: `partner:${dsa.dsa_code}`, status: "New",
        owner_employee_id: ownerEmployee, created_by_employee_id: null, dsa_id: dsa.id,
      }]).select("lead_code").single();
      if (leadErr) throw leadErr;
      leadCode = lead.lead_code;
    }
    // Activity log for the RM (best-effort).
    try {
      await db.from("nw_activity_logs").insert([{
        employee_id: ownerEmployee,
        action: "Bond Offer Enquiry",
        description: `${fullName} (${mobile}) is interested in ${bond.bond_name || bond.isin} via ${dsa.full_name}'s shared link. ${existingLead ? "Existing lead " + leadCode : "Lead " + leadCode}.`,
      }]);
    } catch (_) { /* non-fatal */ }

    return json({ success: true, outcome: "lead", lead_code: leadCode }, 200);
  } catch (err: any) {
    console.error("submit-bond-offer error:", err?.message);
    return json({ error: "Could not submit your request. Please try again." }, 500);
  }
});
