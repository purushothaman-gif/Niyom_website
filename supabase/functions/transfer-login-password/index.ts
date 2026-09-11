import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Rotate the password of a shared Transfer Queue login (role transfer_admin).
//
// The transfer login is handed to whichever employee is doing transfers, so
// the admin needs to change its password when someone who knew it leaves —
// and anyone already signed in must be thrown out, not just future sign-ins.
//
// Deliberately narrow: the target MUST be a transfer_admin. It can never be
// used to take over an employee's or admin's own account.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const db = createClient(supabaseUrl, serviceKey);
    const { data: caller } = await db
      .from("nw_employees")
      .select("role, status")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!caller || caller.status !== "active" || !["admin", "super_admin"].includes(caller.role)) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    const { employee_id, password } = await req.json().catch(() => ({}));
    if (typeof employee_id !== "string" || typeof password !== "string") {
      return json({ error: "employee_id and password are required." }, 400);
    }
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400);
    }

    const { data: target } = await db
      .from("nw_employees")
      .select("id, auth_user_id, role, full_name")
      .eq("id", employee_id)
      .maybeSingle();
    if (!target || !target.auth_user_id) return json({ error: "Login not found." }, 404);
    if (target.role !== "transfer_admin") {
      return json({ error: "Only a Transfer Queue login's password can be changed here." }, 403);
    }

    const { error: pwErr } = await db.auth.admin.updateUserById(target.auth_user_id, { password });
    if (pwErr) return json({ error: pwErr.message }, 500);

    // A new password alone leaves every existing session alive. End them, so
    // a person who has lost access is actually out once their current access
    // token lapses (at most the JWT expiry).
    const { error: revokeErr } = await db.rpc("nw_revoke_auth_sessions", { p_user_id: target.auth_user_id });
    if (revokeErr) {
      console.error("session revoke failed:", revokeErr.message);
      return json({
        success: true,
        sessions_revoked: false,
        warning: "Password changed, but devices already signed in could not be signed out.",
      });
    }

    return json({ success: true, sessions_revoked: true, full_name: target.full_name });
  } catch (err: any) {
    console.error("transfer-login-password error:", err?.message);
    return json({ error: err?.message || "Internal error" }, 500);
  }
});
