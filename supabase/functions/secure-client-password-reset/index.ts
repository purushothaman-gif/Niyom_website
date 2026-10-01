import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { clientAuthEmail } from "../_shared/clientAuth.ts";

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
    //
    // Related clients can share one email, in which case this client's auth
    // user sits under an alias of it (see _shared/clientAuth.ts). Supabase would
    // mail the alias — or, given the shared address, reset the OTHER client. So
    // for an aliased client the recovery link is minted here and mailed to the
    // address on the client record instead.
    const recordEmail = String(client.email).trim().toLowerCase();
    const authEmail = (await clientAuthEmail(adminClient, client)) ?? recordEmail;

    if (authEmail.toLowerCase() === recordEmail) {
      const anonClient = createClient(supabaseUrl, anonKey);
      const { error: resetErr } = await anonClient.auth.resetPasswordForEmail(recordEmail, {
        redirectTo,
      });
      if (resetErr) {
        console.error("Client password reset email error:", resetErr.message);
      }
    } else {
      const { data: link, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: authEmail,
        options: { redirectTo },
      });
      const actionLink = link?.properties?.action_link;
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (linkErr || !actionLink || !RESEND_API_KEY) {
        console.error("Client password reset link error:", linkErr?.message ?? "no link / mail key");
      } else {
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;background:#f6f6f6;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #eee;border-radius:10px;overflow:hidden;">
    <div style="background:#081B33;padding:22px 24px;">
      <div style="font-size:20px;font-weight:700;color:#c9b896;">Niyom Wealth</div>
      <div style="font-size:12px;color:#8A8A8A;">Distribution LLP — Client Portal</div>
    </div>
    <div style="padding:28px 24px;">
      <p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 16px;">Use the button below to set a new password for your Niyom Wealth account.</p>
      <p style="margin:0 0 16px;"><a href="${actionLink}" style="display:inline-block;background:#B8961E;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;">Reset password</a></p>
      <p style="color:#555;font-size:13px;margin:0;">If you did not request this, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Niyom Wealth <support@niyomwealth.com>",
            to: [recordEmail],
            subject: "Reset your password - Niyom Wealth",
            html,
            text: `Set a new password for your Niyom Wealth account: ${actionLink}\nIf you did not request this, please ignore this email.`,
          }),
        });
        if (!res.ok) console.error("Client password reset mail error:", res.status);
      }
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
