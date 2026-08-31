import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";

// resolve-share-offer — PUBLIC (verify_jwt=false). Maps a partner share-link token
// to the unlisted share at the PARTNER'S price (base × approved partner rate × the
// per-share margin) plus the partner's name, for the /share-offer landing page.
//
// SECURITY INVARIANT (the same one bm_public_analytics carries for bonds): the
// response contains ONE price — the fully marked-up one. The partner's cost, the
// approved rate and Niyom's base latest_price are computed here and discarded.
// Never add a field to this payload that lets the recipient back out any of them.

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) return json({ error: "Missing link." }, 400);

    const db = serviceClient();

    const { data: link } = await db
      .from("nw_partner_share_links")
      .select("dsa_id, share_id, margin_percent, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!link) return json({ error: "This link is not valid." }, 404);
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return json({ error: "This link has expired.", expired: true }, 410);
    }

    const { data: dsa } = await db
      .from("nw_dsa")
      .select("id, full_name, employee_id, status, dsa_login_enabled")
      .eq("id", link.dsa_id)
      .maybeSingle();
    if (!dsa || dsa.status !== "active" || !dsa.dsa_login_enabled) {
      return json({ error: "This link is no longer active." }, 410);
    }

    const { data: share } = await db
      .from("us_shares")
      .select("id, isin, company_name, short_name, sector, about, logo_url, website, face_value, lot_size, min_qty, latest_price, active_status")
      .eq("id", link.share_id)
      .maybeSingle();
    if (!share || share.active_status !== "active" || share.latest_price == null) {
      return json({ error: "This share is no longer available." }, 410);
    }

    const { data: rate } = await db.rpc("us_resolve_markup", {
      p_audience: "partner",
      p_client_id: null as unknown as string,
      p_dsa_id: dsa.id,
      p_employee_id: (dsa.employee_id ?? null) as unknown as string,
    });
    if (rate == null) return json({ error: "This offer is no longer available." }, 410);

    const pricePerShare = round2(
      Number(share.latest_price) * (1 + Number(rate) / 100) * (1 + Number(link.margin_percent) / 100),
    );

    return json({
      partner_name: dsa.full_name || "Your advisor",
      share: {
        isin: share.isin,
        company_name: share.company_name,
        short_name: share.short_name,
        sector: share.sector,
        about: share.about,
        logo_url: share.logo_url,
        website: share.website,
        face_value: share.face_value,
        lot_size: share.lot_size,
        min_qty: share.min_qty,
        price_per_share: pricePerShare,
      },
    }, 200);
  } catch (err: any) {
    console.error("resolve-share-offer error:", err?.message);
    return json({ error: "Could not open this offer. Please try again." }, 500);
  }
});
