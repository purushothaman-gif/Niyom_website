import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * client-google-resolve
 * ---------------------
 * The gate between "signed in with Google" and "is a Niyom client".
 *
 * A Google session by itself means nothing here: our client identity is a row
 * in nw_clients, provisioned by a relationship manager against a verified PAN.
 * This function takes the caller's freshly-minted Supabase JWT and answers one
 * question — which client record, if any, does this person own?
 *
 * Deliberately NOT done in the browser: the lookup needs the service role (a
 * client cannot read nw_clients rows that are not already theirs), and the
 * decision about linking an auth user to a client record is exactly the kind of
 * thing that must not be influenced by anything the browser says. The only
 * input trusted here is the verified JWT.
 *
 * Public (verify_jwt = false) because it verifies the bearer token itself and
 * needs to return its own errors rather than a bare 401.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ code: "no_session", error: "Not signed in." }, 401);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await db.auth.getUser(jwt);
    const user = userData?.user;
    if (userErr || !user) return json({ code: "no_session", error: "Not signed in." }, 401);

    /*
     * The email must come from Google and be verified BY Google. An unverified
     * address would let anyone who can create an account claiming a client's
     * email walk into that client's portfolio.
     */
    const identities = user.identities ?? [];
    const google = identities.find((i) => i.provider === "google");
    if (!google) return json({ code: "not_google", error: "Not a Google sign-in." }, 400);

    const identityData = (google.identity_data ?? {}) as Record<string, unknown>;
    const emailVerified =
      identityData.email_verified === true || identityData.email_verified === "true";
    const email = String(identityData.email ?? user.email ?? "").trim().toLowerCase();
    if (!email || !emailVerified) {
      return json(
        { code: "email_unverified", error: "Your Google account's email is not verified." },
        403,
      );
    }

    // 1) Already linked — the ordinary case on every login after the first.
    const { data: byUid } = await db
      .from("nw_clients")
      .select("id, client_login_enabled, client_password_changed")
      .eq("client_auth_user_id", user.id)
      .maybeSingle();

    if (byUid) {
      if (!byUid.client_login_enabled) {
        return json({ code: "login_disabled", error: "Portal access is disabled for this account." }, 403);
      }
      return json({
        client_id: byUid.id,
        password_changed: byUid.client_password_changed,
      });
    }

    // 2) Not linked yet — find the client by the Google-verified email.
    const { data: byEmail } = await db
      .from("nw_clients")
      .select("id, client_auth_user_id, client_login_enabled, client_password_changed")
      .ilike("email", email)
      .maybeSingle();

    if (!byEmail) {
      return json({ code: "no_account", error: "No Niyom account uses this email address." }, 404);
    }

    if (!byEmail.client_login_enabled) {
      return json({ code: "login_disabled", error: "Portal access is disabled for this account." }, 403);
    }

    /*
     * The client already has a DIFFERENT auth user. Supabase should have linked
     * the Google identity to it (same confirmed email), so reaching here means
     * something is off — and quietly repointing client_auth_user_id at the new
     * user would be an account takeover with extra steps. Refuse, and send them
     * down the PAN + password path that is known to reach the right record.
     */
    if (byEmail.client_auth_user_id && byEmail.client_auth_user_id !== user.id) {
      console.warn(
        `google-resolve: email ${email} maps to client ${byEmail.id} whose auth user ` +
          `(${byEmail.client_auth_user_id}) differs from the caller (${user.id}); refusing to relink.`,
      );
      return json(
        {
          code: "use_password",
          error: "This account signs in with PAN and password. Please use that, then link Google from Profile.",
        },
        409,
      );
    }

    // 3) A client with no auth user yet: adopt this one.
    const { error: linkErr } = await db
      .from("nw_clients")
      .update({ client_auth_user_id: user.id })
      .eq("id", byEmail.id)
      .is("client_auth_user_id", null);

    if (linkErr) {
      console.error("google-resolve link failed:", linkErr.message);
      return json({ code: "link_failed", error: "Could not complete sign-in. Please try again." }, 500);
    }

    return json({
      client_id: byEmail.id,
      password_changed: byEmail.client_password_changed,
      linked: true,
    });
  } catch (err) {
    console.error("client-google-resolve error:", err instanceof Error ? err.message : err);
    return json({ code: "error", error: "Could not complete sign-in." }, 500);
  }
});
