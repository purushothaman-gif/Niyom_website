// Someone who wants to become a Niyom distribution partner, from the app.
//
// A partner account cannot be self-created — a DSA login is provisioned by an
// RM after an agreement and an ARN check — so this does not try to make one. It
// records the interest as a LEAD in the admin pool, which is the queue an admin
// already works from, and returns the lead code so the person has a reference.
//
// ## Why this is public
//
// The people it exists for have no Niyom account by definition, so there is no
// token to check. `verify_jwt` is off and the anon key is the only credential —
// the same posture as `public-onboard-pan-verify` and `public-onboard-start`.
//
// ## What stops it being an open spam pipe into the CRM
//
//   1. Mobile is the lead's practical identity, and a mobile already in
//      nw_leads is refused. That kills the repeat-submit case.
//   2. A global circuit breaker: if this endpoint has already created
//      HOURLY_CAP leads in the last hour, further ones are refused. A flood
//      therefore costs the CRM a bounded number of rows rather than a cleanup
//      job, and real enquiries in a quiet hour are never touched.
//   3. Every field is length-capped and the row is written by a service-role
//      client with an explicit column list — nothing from the request chooses
//      an owner, a status or a score.
//
// ## What it deliberately does NOT do
//
// No new table, no schema change, no constraint change. `lead_origin` reuses
// the existing 'website_signup' value; what marks these out for an admin is
// `lead_source` and `campaign`, which the CRM lead list already filters on.
//
// `owner_employee_id` is left NULL, which nw_leads documents as the ADMIN POOL.
// That is the point: an admin picks these up and assigns them, rather than one
// RM silently receiving every partner enquiry.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Most partner enquiries a single hour can add to the CRM from this endpoint. */
const HOURLY_CAP = 40;

const LEAD_SOURCE = 'Partner Enquiry — App';
const CAMPAIGN = 'app:become-a-partner';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const fullName = String(body.full_name ?? '').trim().slice(0, 120);
    const mobile = String(body.mobile ?? '').replace(/\D/g, '').slice(0, 15);
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 160);
    const city = String(body.city ?? '').trim().slice(0, 80);
    const arn = String(body.arn ?? '').trim().slice(0, 40);
    const note = String(body.remarks ?? '').trim().slice(0, 500);

    if (fullName.length < 2) return json({ error: 'Please enter your name.' }, 400);
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return json({ error: 'Please enter a valid 10-digit mobile number.' }, 400);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address.' }, 400);
    }

    // --- Circuit breaker ----------------------------------------------------
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recent } = await db
      .from('nw_leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign', CAMPAIGN)
      .gte('created_at', anHourAgo);

    if ((recent ?? 0) >= HOURLY_CAP) {
      // Deliberately not "you are rate limited" — the person in front of this
      // has done nothing wrong, and a phone number is a route that still works.
      return json(
        {
          error:
            'We could not record your enquiry just now. Please call us on +91 89392 00110 and we will pick it up straight away.',
          code: 'busy',
        },
        503,
      );
    }

    // --- Duplicate guard ----------------------------------------------------
    const { data: existing } = await db
      .from('nw_leads')
      .select('id, lead_code')
      .eq('mobile', mobile)
      .eq('is_archived', false)
      .limit(1)
      .maybeSingle();

    if (existing) {
      /*
       * A 200, not a 409. This endpoint is unauthenticated, so a distinct
       * "already exists" answer would let anyone test whether a given mobile
       * number is in Niyom's CRM. The submitter sees the same reassurance
       * either way, and no second row is created.
       */
      return json({ success: true, duplicate: true }, 200);
    }

    // --- Record it ----------------------------------------------------------
    const remarks = [
      'Wants to become a Niyom distribution partner (submitted from the mobile app).',
      arn ? `ARN: ${arn}` : 'ARN: not provided',
      note ? `Note: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { data: lead, error: leadErr } = await db
      .from('nw_leads')
      .insert([
        {
          lead_name: fullName,
          mobile,
          email,
          city,
          interested_product: 'Partner / DSA',
          remarks,
          // An existing allowed value — this endpoint adds no constraint change.
          lead_origin: 'website_signup',
          lead_source: LEAD_SOURCE,
          campaign: CAMPAIGN,
          status: 'New',
          // NULL = the admin pool. An admin assigns these.
          owner_employee_id: null,
          created_by_employee_id: null,
        },
      ])
      .select('id, lead_code')
      .single();

    if (leadErr) {
      console.error('public-partner-enquiry insert failed:', leadErr.message);
      return json({ error: 'Could not record your enquiry. Please try again.' }, 500);
    }

    // Best-effort trail for the admin queue. The lead already exists.
    try {
      await db.from('nw_activity_logs').insert([
        {
          employee_id: null,
          action: 'Partner Enquiry (App)',
          description:
            `${fullName} (${mobile}) asked about becoming a distribution partner ` +
            `via the mobile app. Lead ${lead.lead_code} is in the admin pool.`,
        },
      ]);
    } catch (logErr) {
      console.error('activity log failed (lead already created):', logErr);
    }

    return json({ success: true, lead_code: lead.lead_code }, 200);
  } catch (err) {
    console.error('public-partner-enquiry failed:', err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
