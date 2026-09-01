// One-click unsubscribe for campaign mail.
//
// This is the ONLY anon-reachable surface in the campaign feature, so it is
// deliberately tiny and does exactly one thing.
//
// Two entry points, both carrying the recipient's own random token:
//   POST — RFC 8058 one-click, called by Gmail/Outlook's own Unsubscribe
//          button without the reader ever seeing a page.
//   GET  — a human clicking the footer link; returns a small branded page.
//
// It NEVER reveals the address behind a token, and an unknown token renders
// exactly the same page as a known one. Anything else would turn this into an
// address-enumeration oracle reachable without a session — the same shape of
// problem as the PAN to email oracle closed on 2026-08-09. The token is 256
// bits of randomness, so the page tells an attacker nothing they could use.
//
// The page is served from here rather than as an SPA route so that an opt-out
// works even if the site build is broken — the one request a regulator would
// ask about should not depend on Vercel.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SITE = "https://www.niyomwealth.com";
const COMPANY = "Niyom Wealth Distribution LLP";
const SUPPORT_EMAIL = "support@niyomwealth.com";
const GOLD = "#8B7355";

function page(title: string, message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Niyom Wealth</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:48px 20px;">
    <div style="background:#fff;border-radius:10px;padding:36px 32px;">
      <img src="${SITE}/email/niyom-logo.png" width="60" height="60" alt="${COMPANY}" style="display:block;border:0;height:auto;" />
      <h1 style="margin:22px 0 10px;font-size:20px;color:#111;">${title}</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#444;">${message}</p>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#777;">
        You will still receive essential messages about your account and any transactions you make —
        those are not marketing and cannot be switched off.
      </p>
      <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#777;">
        Changed your mind, or need help? Write to
        <a href="mailto:${SUPPORT_EMAIL}" style="color:${GOLD};">${SUPPORT_EMAIL}</a>.
      </p>
    </div>
    <p style="text-align:center;margin:20px 0 0;font-size:12px;color:#999;">&copy; ${new Date().getFullYear()} ${COMPANY}</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const DONE_TITLE = "You have been unsubscribed";
const DONE_BODY =
  "You will no longer receive marketing updates from Niyom Wealth at this address.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  // The token may arrive in the query string (the footer link and the
  // List-Unsubscribe header both use it) or in a POST body.
  let token = new URL(req.url).searchParams.get("t") ?? "";
  if (!token && req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        token = String(((await req.json()) as { token?: unknown }).token ?? "");
      } else {
        token = String((await req.formData()).get("t") ?? "");
      }
    } catch {
      token = "";
    }
  }

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // The RPC returns a bare boolean and is granted to service_role only. The
    // result is logged but never branched on for the reader: known and unknown
    // tokens must be indistinguishable from outside.
    const { data, error } = await db.rpc("mail_unsubscribe_by_token", { p_token: token });
    if (error) console.error("unsubscribe rpc failed:", error);
    else console.log("unsubscribe token matched:", data === true);
  } catch (err) {
    // A failure here must not tell the caller anything either. It is logged for
    // us; the reader still sees confirmation, and a genuine miss surfaces as a
    // client still receiving mail, which support can fix by hand.
    console.error("unsubscribe failed:", err);
  }

  if (req.method === "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return page(DONE_TITLE, DONE_BODY);
});
