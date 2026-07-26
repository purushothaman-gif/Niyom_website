import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Client password policy — returns null if OK. Mirrors src/lib/passwordPolicy.ts.
function passwordError(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Password must include a lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must include a symbol.";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify the caller is an authenticated employee
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user: caller } } = await adminClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is an active employee
    const { data: emp } = await adminClient
      .from("nw_employees").select("id, role")
      .eq("auth_user_id", caller.id).eq("status", "active").maybeSingle();

    if (!emp) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { client_id, email, pan, initial_password } = body;

    if (!client_id || !email || !pan || !initial_password) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client password policy (mirrors src/lib/passwordPolicy.ts and
    // reset-password-with-otp; kept inline since edge fns can't import src/).
    const pwErr = passwordError(initial_password);
    if (pwErr) {
      return new Response(JSON.stringify({ error: pwErr }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the client record exists and doesn't already have login
    const { data: client } = await adminClient
      .from("nw_clients").select("id, pan, email, client_auth_user_id")
      .eq("id", client_id).maybeSingle();

    if (!client) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (client.client_auth_user_id) {
      return new Response(JSON.stringify({ error: "Client login already exists" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let authUserId: string;

    // Check if an auth user with this email already exists (e.g. registered on public site)
    const { data: { users: existingUsers } } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.find((u) => u.email?.toLowerCase() === normalizedEmail);

    if (existingUser) {
      // Reuse existing auth user — update their password and tag as client
      const { error: updateAuthErr } = await adminClient.auth.admin.updateUserById(existingUser.id, {
        password: initial_password,
        email_confirm: true,
        user_metadata: {
          ...existingUser.user_metadata,
          client_id,
          pan: pan.toUpperCase(),
          is_client: true,
        },
      });
      if (updateAuthErr) {
        return new Response(JSON.stringify({ error: updateAuthErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      authUserId = existingUser.id;
    } else {
      // Create a brand new auth user
      const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
        email: normalizedEmail,
        password: initial_password,
        email_confirm: true,
        user_metadata: {
          client_id,
          pan: pan.toUpperCase(),
          is_client: true,
        },
      });
      if (createErr) {
        return new Response(JSON.stringify({ error: createErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      authUserId = newUser.user.id;
    }

    // Link auth user to client record
    const { error: updateErr } = await adminClient
      .from("nw_clients")
      .update({
        client_auth_user_id: authUserId,
        client_login_enabled: true,
        client_password_changed: false,
      })
      .eq("id", client_id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, auth_user_id: authUserId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("create-client-login error:", err?.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
