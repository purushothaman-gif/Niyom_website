import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * client-pin-manage
 * -----------------
 * The client's own view of where their PIN works: list the remembered devices,
 * and turn any of them off. Requires a full session — signing out a device is
 * a security action, so it needs more than knowing a PIN.
 *
 * `pin_hash` and `pin_salt` are never selected here. The table has no RLS
 * policies precisely so that this function is the only way to see any of it,
 * and it only ever returns the columns a person needs to recognise a device.
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
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Please sign in first." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData } = await db.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "Please sign in first." }, 401);

    const { data: client } = await db
      .from("nw_clients")
      .select("id")
      .eq("client_auth_user_id", user.id)
      .maybeSingle();
    if (!client) return json({ error: "Please sign in first." }, 403);

    if (action === "list") {
      const { data, error } = await db
        .from("nw_client_device_pins")
        .select("device_id, device_label, created_at, last_used_at, expires_at, revoked_at, locked_until")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ devices: data ?? [] });
    }

    if (action === "revoke") {
      const deviceId = String(body.device_id ?? "").trim();
      if (!deviceId) return json({ error: "Which device?" }, 400);
      const { error } = await db
        .from("nw_client_device_pins")
        .update({ revoked_at: new Date().toISOString() })
        .eq("client_id", client.id)
        .eq("device_id", deviceId);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "revoke_all") {
      const { error } = await db
        .from("nw_client_device_pins")
        .update({ revoked_at: new Date().toISOString() })
        .eq("client_id", client.id)
        .is("revoked_at", null);
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("client-pin-manage error:", err instanceof Error ? err.message : err);
    return json({ error: "Could not complete that. Please try again." }, 500);
  }
});
