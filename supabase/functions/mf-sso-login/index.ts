import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient } from "../_shared/onboarding.ts";
import { getWylthGateway } from "../_shared/wylthGateway.ts";

// WHITE-LABEL: the platform (Wylth) must never be named in anything a client,
// partner or RM sees — responses, alert text, URLs. Server-side names only.
//
// mf-sso-login — the client clicks Mutual Funds in the wealth portal and we
// hand back a one-time Wylth sign-in link (Wylth Investor SSO v1.0). Runs public
// (verify_jwt=false) but requires the client's own bearer token and verifies
// ownership of the client record server-side; the PAN is read from nw_clients,
// never taken from the request.
//
// Wylth's spec covers investors only. Partner and employee callers are answered
// `not_available` until Wylth ships a distributor/admin SSO spec.
//
// Never log the PAN, the encrypted payload or redirect_url — the link is a
// credential. nw_wylth_sso_log keeps the outcome only.

type Outcome = "ok" | "not_mapped" | "kyc_incomplete" | "not_available" | "error";

const ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const db = serviceClient();
  const log = (row: {
    caller_type: "client" | "partner" | "employee";
    caller_auth_id: string;
    client_id?: string | null;
    outcome: Outcome;
    wylth_message?: string | null;
    latency_ms?: number | null;
  }) => db.from("nw_wylth_sso_log").insert(row).then(({ error }) => {
    if (error) console.error("mf-sso-login: log insert failed", error.message);
  });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    if (user.user_metadata?.is_client !== true) {
      // Staff / partner SSO isn't defined by Wylth yet.
      const callerType = user.user_metadata?.is_partner === true ? "partner" : "employee";
      await log({ caller_type: callerType, caller_auth_id: user.id, outcome: "not_available" });
      return json({ status: "not_available" });
    }

    const body = await req.json().catch(() => ({}));
    const client_id = String(body.client_id ?? "").trim();
    if (!client_id) return json({ error: "Missing client." }, 400);

    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_code, pan, pan_verified, employee_id, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);

    const pan = (client.pan ?? "").trim().toUpperCase();
    if (!pan || client.pan_verified !== true) {
      await log({ caller_type: "client", caller_auth_id: user.id, client_id, outcome: "kyc_incomplete" });
      return json({ status: "kyc_incomplete" });
    }

    const gateway = getWylthGateway();
    if (!gateway) {
      console.error("mf-sso-login: Wylth credentials are not configured");
      await log({ caller_type: "client", caller_auth_id: user.id, client_id, outcome: "error", wylth_message: "not configured" });
      return json({ status: "error" });
    }

    const started = Date.now();
    const result = await gateway.login(pan);
    const latency_ms = Date.now() - started;

    if (result.ok) {
      await log({ caller_type: "client", caller_auth_id: user.id, client_id, outcome: "ok", latency_ms });
      return json({ status: "ok", redirect_url: result.redirectUrl });
    }

    if (result.notMapped) {
      // Alert the RM so they get the PAN mapped at Wylth — at most once a day
      // per client, however often the client retries.
      const since = new Date(Date.now() - ALERT_DEDUPE_MS).toISOString();
      const { count } = await db
        .from("nw_wylth_sso_log")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client_id)
        .eq("outcome", "not_mapped")
        .gte("created_at", since);
      await log({ caller_type: "client", caller_auth_id: user.id, client_id, outcome: "not_mapped", wylth_message: result.message, latency_ms });
      if (!count && client.employee_id) {
        const who = `${client.full_name || "A client"}${client.client_code ? ` (${client.client_code})` : ""}`;
        const { error: alertErr } = await db.from("nw_alerts").insert({
          employee_id: client.employee_id,
          title: "Client not mapped on MF platform",
          message: `${who} tried to open Mutual Funds but isn't mapped on the MF platform yet — send their PAN to the platform team for mapping.`,
          category: "mf_mapping",
          action_url: "/clients",
        });
        if (alertErr) console.error("mf-sso-login: RM alert failed", alertErr.message);
      }
      return json({ status: "not_mapped" });
    }

    console.error("mf-sso-login: Wylth login failed:", result.message);
    await log({ caller_type: "client", caller_auth_id: user.id, client_id, outcome: "error", wylth_message: result.message, latency_ms });
    return json({ status: "error" });
  } catch (e) {
    console.error("mf-sso-login: unexpected", e instanceof Error ? e.message : e);
    return json({ status: "error" }, 500);
  }
});
