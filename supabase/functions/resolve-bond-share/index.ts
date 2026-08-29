import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";

// resolve-bond-share — PUBLIC (verify_jwt=false). Maps a partner share token to the
// bond at the PARTNER'S price (base × approved partner rate × the per-bond margin)
// plus the partner's name, for the /bond-offer landing page. The partner's cost and
// Niyom's latest_price never appear in the response.

function round4(n: number): number { return Math.round((n + Number.EPSILON) * 10000) / 10000; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) return json({ error: "Missing link." }, 400);

    const db = serviceClient();

    const { data: share } = await db
      .from("nw_partner_bond_shares")
      .select("dsa_id, bond_id, margin_percent, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!share) return json({ error: "This link is not valid." }, 404);
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return json({ error: "This link has expired.", expired: true }, 410);
    }

    const { data: dsa } = await db
      .from("nw_dsa")
      .select("id, full_name, employee_id, status, dsa_login_enabled")
      .eq("id", share.dsa_id)
      .maybeSingle();
    if (!dsa || dsa.status !== "active" || !dsa.dsa_login_enabled) {
      return json({ error: "This link is no longer active." }, 410);
    }

    const { data: bond } = await db
      .from("bm_bonds")
      .select("id, isin, bond_name, coupon_rate, coupon_type, coupon_frequency, maturity_date, next_coupon_date, issue_date, rating, rating_agency, security_type, seniority, tax_status, trustee, day_count_convention, principal_repayment_structure, min_investment, face_value, latest_price, active_status, verification_status, analytics, issuer_id")
      .eq("id", share.bond_id)
      .maybeSingle();
    if (!bond || bond.active_status !== "active" || bond.verification_status !== "verified" || bond.latest_price == null) {
      return json({ error: "This bond is no longer available." }, 410);
    }

    const { data: rate } = await db.rpc("bm_resolve_markup", {
      p_audience: "partner",
      p_client_id: null as unknown as string,
      p_dsa_id: dsa.id,
      p_employee_id: (dsa.employee_id ?? null) as unknown as string,
    });
    if (rate == null) return json({ error: "This offer is no longer available." }, 410);

    let issuer_name: string | null = null;
    if (bond.issuer_id) {
      const { data: iss } = await db.from("bm_issuers").select("name").eq("id", bond.issuer_id).maybeSingle();
      issuer_name = iss?.name ?? null;
    }

    const pricePer100 = round4(Number(bond.latest_price) * (1 + Number(rate) / 100) * (1 + Number(share.margin_percent) / 100));

    // Strip the price-revealing analytics keys (they carry the base latest_price).
    const analytics = (bond.analytics ?? null) as Record<string, unknown> | null;
    if (analytics) { delete analytics.clean_price; delete analytics.dirty_price; delete analytics.current_yield; }

    return json({
      partner_name: dsa.full_name || "Your advisor",
      bond: {
        isin: bond.isin, bond_name: bond.bond_name, issuer_name,
        coupon_rate: bond.coupon_rate, coupon_type: bond.coupon_type, coupon_frequency: bond.coupon_frequency,
        maturity_date: bond.maturity_date, next_coupon_date: bond.next_coupon_date, issue_date: bond.issue_date,
        rating: bond.rating, rating_agency: bond.rating_agency, security_type: bond.security_type,
        seniority: bond.seniority, tax_status: bond.tax_status, trustee: bond.trustee,
        day_count_convention: bond.day_count_convention, principal_repayment_structure: bond.principal_repayment_structure,
        min_investment: bond.min_investment, face_value: bond.face_value,
        price_per_100: pricePer100, analytics,
      },
    }, 200);
  } catch (err: any) {
    console.error("resolve-bond-share error:", err?.message);
    return json({ error: "Could not open this offer. Please try again." }, 500);
  }
});
