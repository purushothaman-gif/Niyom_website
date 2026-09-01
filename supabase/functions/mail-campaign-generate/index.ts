// Keywords in, a full email draft out.
//
// Reuses the marketing engine's Anthropic transport wholesale — key handling,
// error mapping, and the two request settings that were arrived at by watching
// generations fail — with an email-shaped system prompt and schema passed in.
// See _shared/mail/prompt.ts for why those are a separate pair.
//
// Like mkt-generate-content, this deliberately does NOT write to the database.
// It returns the draft to the browser, which saves it under the admin's own
// JWT, so RLS applies and created_by is a real person rather than the service
// role. A generator that wrote its own rows would also be a generator that
// could fill the campaign table from a replayed request.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAnthropic, resolveApiKey } from "../_shared/mkt/anthropic.ts";
import { lint } from "../_shared/mkt/compliance.ts";
import { buildEmailUserMessage, EMAIL_DRAFT_SCHEMA, EMAIL_SYSTEM_PROMPT } from "../_shared/mail/prompt.ts";
import { blockText } from "../_shared/mail/blocks.ts";
import type { MailBlock } from "../_shared/mail/blocks.ts";

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

interface RawBlock {
  type?: unknown;
  text?: unknown;
  items?: unknown;
}

/**
 * The model returns every block with all three fields (structured outputs
 * cannot express a discriminated union), so unused fields arrive as null.
 * Collapse that back into the real block shape and drop anything empty — an
 * empty heading would render as blank space in every inbox.
 */
function toBlocks(raw: unknown): MailBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: MailBlock[] = [];
  for (const b of raw as RawBlock[]) {
    const text = typeof b?.text === "string" ? b.text.trim() : "";
    switch (b?.type) {
      case "heading":
        if (text) out.push({ type: "heading", text });
        break;
      case "paragraph":
        if (text) out.push({ type: "paragraph", text });
        break;
      case "bullets": {
        const items = Array.isArray(b.items)
          ? b.items.filter((i): i is string => typeof i === "string" && i.trim() !== "")
          : [];
        if (items.length) out.push({ type: "bullets", items });
        break;
      }
      case "divider":
        out.push({ type: "divider" });
        break;
      default:
        break;
    }
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !callerUser) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: caller } = await admin
      .from("nw_employees").select("role, status")
      .eq("auth_user_id", callerUser.id).maybeSingle();

    if (!caller || caller.status !== "active" || !["admin", "super_admin"].includes(caller.role)) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    const key = resolveApiKey(Deno.env.get("ANTHROPIC_API_KEY"));
    if ("error" in key) return json({ error: key.error }, 500);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const keywords = String(body.keywords ?? "").trim();
    if (!keywords) return json({ error: "Give the generator a few keywords to work from." }, 400);

    const brief = {
      audience: body.audience === "partner" ? "partner" as const : "client" as const,
      keywords,
      purpose: String(body.purpose ?? "Announcement"),
      tone: String(body.tone ?? "Straightforward"),
      length: String(body.length ?? "Medium (5-7 blocks)"),
    };

    const { draft } = await callAnthropic(
      key.key,
      [{ role: "user", content: buildEmailUserMessage(brief) }],
      { system: EMAIL_SYSTEM_PROMPT, schema: EMAIL_DRAFT_SCHEMA as unknown as Record<string, unknown> },
    );

    const blocks = toBlocks(draft.blocks);
    const subject = String(draft.subject ?? "").trim();
    const preheader = String(draft.preheader ?? "").trim();

    if (!subject || blocks.length === 0) {
      return json({ error: "The model returned an empty draft. Try again with more specific keywords." }, 502);
    }

    // The prompt instructs at length about compliance, but instructions are
    // guidance — this regex pass is the gate, exactly as it is for social
    // content. Findings are RETURNED rather than enforced here: an email
    // legitimately saying "we do not recommend timing the market" trips the
    // recommendation pattern, so the admin acknowledges flags at approval
    // time and that acknowledgement is recorded against the campaign.
    const flags = lint({
      title: subject,
      headline: preheader,
      body: blockText(blocks),
    });

    return json({ subject, preheader, blocks, flags });
  } catch (err) {
    console.error("mail-campaign-generate failed:", err);
    return json({ error: err instanceof Error ? err.message : "Generation failed." }, 500);
  }
});
