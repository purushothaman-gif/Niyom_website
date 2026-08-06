/**
 * create-partner-login — an RM/admin enables portal access for one of their
 * DSAs, issuing a temporary password the partner must change on first sign-in.
 *
 * Modelled on create-client-login, with four deliberate deviations:
 *
 *   1. OWNERSHIP. create-client-login lets ANY active employee provision ANY
 *      client. Here a non-admin may only enable partners assigned to them.
 *
 *   2. SEPARATE IDENTITY. Some DSAs are also clients (same PAN and email). One
 *      email = one auth user, so reusing it would silently reset that person's
 *      client-portal password. Per the agreed product decision the two logins
 *      stay separate: we refuse and ask the RM to record a distinct email.
 *
 *   3. PAGINATION. listUsers() defaults to 50 per page; the original silently
 *      misses existing users beyond page 1 and then fails createUser with an
 *      opaque duplicate-email error. This loops properly.
 *      (create-client-login has the same bug — worth a follow-up.)
 *
 *   4. METADATA. is_partner, never is_client — raise-support-ticket and
 *      public-request-product-activation both gate on is_client.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Mirrors src/lib/passwordPolicy.ts — edge functions cannot import from src/. */
function passwordError(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Password must include a lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must include a symbol.";
  return null;
}

/** listUsers() is paginated — walk every page before concluding "not found". */
async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const users = data?.users ?? [];
    const hit = users.find((u: { email?: string }) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 1000) return null;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Caller must be an active employee ---------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { data: { user: caller } } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const { data: emp } = await admin
      .from("nw_employees")
      .select("id, role")
      .eq("auth_user_id", caller.id)
      .eq("status", "active")
      .maybeSingle();
    if (!emp) return json({ error: "Unauthorized" }, 403);

    const isAdmin = emp.role === "admin" || emp.role === "super_admin";

    // --- Validate input ----------------------------------------------------
    const body = await req.json().catch(() => ({}));
    const { dsa_id, email, pan, initial_password } = body ?? {};
    if (!dsa_id || !email || !pan || !initial_password) {
      return json({ error: "Missing required fields" }, 400);
    }

    const normalizedPan = String(pan).trim().toUpperCase();
    if (!PAN_RE.test(normalizedPan)) return json({ error: "Invalid PAN format." }, 400);

    const pwErr = passwordError(initial_password);
    if (pwErr) return json({ error: pwErr }, 400);

    // --- Resolve the DSA and check ownership -------------------------------
    const { data: dsa } = await admin
      .from("nw_dsa")
      .select("id, dsa_code, employee_id, pan, email, status, dsa_auth_user_id")
      .eq("id", dsa_id)
      .maybeSingle();
    if (!dsa) return json({ error: "Partner not found" }, 404);

    if (!isAdmin && dsa.employee_id !== emp.id) {
      return json({ error: "You can only enable login for your own partners." }, 403);
    }
    if (dsa.status !== "active") {
      return json({ error: "This partner is inactive. Reactivate the DSA first." }, 409);
    }
    if (dsa.dsa_auth_user_id) {
      return json({ error: "Partner login already exists." }, 409);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // --- Separate-identity enforcement -------------------------------------
    // A DSA who is also a client keeps two distinct logins, so the partner
    // login must not reuse the auth user that backs their client portal.
    const { data: clientRow } = await admin
      .from("nw_clients")
      .select("id, client_code")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    const existingUser = await findUserByEmail(admin, normalizedEmail);

    if (clientRow || existingUser?.user_metadata?.is_client === true) {
      return json({
        error:
          "This email already has a client login. Record a different email on " +
          "the DSA record before enabling partner access — partner and client " +
          "logins are kept separate.",
        code: "email_belongs_to_client",
      }, 409);
    }

    // --- Create or adopt the auth user -------------------------------------
    let authUserId: string;

    if (existingUser) {
      // A non-client auth user already owns this email (e.g. a prior partner
      // provisioning attempt that failed after createUser). Adopt it.
      const { error: updErr } = await admin.auth.admin.updateUserById(existingUser.id, {
        password: initial_password,
        email_confirm: true,
        user_metadata: {
          ...existingUser.user_metadata,
          dsa_id,
          pan: normalizedPan,
          is_partner: true,
        },
      });
      if (updErr) return json({ error: updErr.message }, 500);
      authUserId = existingUser.id;
    } else {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password: initial_password,
        email_confirm: true,
        user_metadata: { dsa_id, pan: normalizedPan, is_partner: true },
      });
      if (createErr) return json({ error: createErr.message }, 500);
      authUserId = newUser.user.id;
    }

    // --- Link it to the DSA record -----------------------------------------
    const { error: linkErr } = await admin
      .from("nw_dsa")
      .update({
        dsa_auth_user_id: authUserId,
        dsa_login_enabled: true,
        dsa_password_changed: false,
        email: normalizedEmail,
      })
      .eq("id", dsa_id);
    if (linkErr) return json({ error: linkErr.message }, 500);

    await admin.from("nw_dsa_login_audit").insert({
      dsa_id,
      action: "login_enabled",
      actor: "employee",
      metadata: { by_employee_id: emp.id, dsa_code: dsa.dsa_code },
    });

    return json({ success: true, auth_user_id: authUserId }, 200);
  } catch (err) {
    console.error("create-partner-login error:", (err as Error)?.message);
    return json({ error: "Internal server error" }, 500);
  }
});
