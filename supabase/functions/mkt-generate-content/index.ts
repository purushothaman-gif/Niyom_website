// Marketing Tool — educational content generation (admin only).
//
// This file is now only the HTTP and auth layer. Everything that decides what
// gets written — the prompt, the schema, the model call, the compliance lint,
// the corrective retry, the uniqueness checks — lives in _shared/mkt/ so the
// automated daily batch runs the identical pipeline. See _shared/mkt/generate.ts.
//
// This function deliberately does NOT write to mkt_content. The admin saves the
// draft from the CRM under their own JWT so RLS applies and created_by is the
// real author.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveApiKey } from "../_shared/mkt/anthropic.ts";
import { generateDraft } from "../_shared/mkt/generate.ts";
import { toBrief } from "../_shared/mkt/prompt.ts";

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
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const key = resolveApiKey(Deno.env.get("ANTHROPIC_API_KEY"));
    if ("error" in key) return json({ error: key.error }, 503);

    // Identify the caller under their own JWT...
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser) return json({ error: "Unauthorized" }, 401);

    // ...then verify their role with the service role.
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: caller } = await admin
      .from("nw_employees")
      .select("role, status")
      .eq("auth_user_id", callerUser.id)
      .maybeSingle();

    const authorised = caller && ["admin", "super_admin"].includes(caller.role as string) && caller.status === "active";
    if (!authorised) return json({ error: "Forbidden: admin access required" }, 403);

    const body = await req.json();
    if (!body?.category) return json({ error: "category is required" }, 400);

    const result = await generateDraft({
      cfg: { supabaseUrl, supabaseServiceRoleKey: serviceRoleKey },
      apiKey: key.key,
      brief: toBrief(body),
    });

    return json({
      success: true,
      draft: result.draft,
      lint: { passed: result.flags.length === 0, flagged: result.flags },
      usage: result.usage
        ? { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens }
        : undefined,
      model: result.model,
    });
  } catch (err) {
    console.error("mkt-generate-content failed:", err);
    return json({ error: err instanceof Error ? err.message : "Content generation failed" }, 500);
  }
});
