import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GENERIC_RESPONSE = { message: "If your PAN is registered, reset instructions will be sent to your email." };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const pan: string = (body.pan || "").trim().toUpperCase();

    if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      return new Response(JSON.stringify(GENERIC_RESPONSE), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Use admin client to verify PAN belongs to a real client with login enabled
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: client } = await adminClient
      .from("nw_clients")
      .select("id, email, client_login_enabled, client_auth_user_id")
      .eq("pan", pan)
      .eq("client_login_enabled", true)
      .maybeSingle();

    if (!client || !client.client_auth_user_id || !client.email) {
      return new Response(JSON.stringify(GENERIC_RESPONSE), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send the client to the dedicated reset screen, which reads the recovery
    // session and lets them set a new password. (If this exact path is not in
    // the project's allowed-redirect list, Supabase falls back to the Site URL —
    // the app still routes to the reset screen via its recovery safety net.)
    const origin = req.headers.get("Origin") || req.headers.get("Referer") || "";
    const baseUrl = origin.split("/").slice(0, 3).join("/");
    const redirectTo = baseUrl ? `${baseUrl}/client-reset-password` : `${supabaseUrl}/client-reset-password`;

    // Use the public anon client to send the actual password reset email
    // (resetPasswordForEmail sends a real email; admin generateLink only creates a link)
    const anonClient = createClient(supabaseUrl, anonKey);
    const { error: resetErr } = await anonClient.auth.resetPasswordForEmail(client.email, {
      redirectTo,
    });

    if (resetErr) {
      console.error("Client password reset email error:", resetErr.message);
    }

    return new Response(JSON.stringify(GENERIC_RESPONSE), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("secure-client-password-reset error:", err?.message);
    return new Response(JSON.stringify(GENERIC_RESPONSE), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
