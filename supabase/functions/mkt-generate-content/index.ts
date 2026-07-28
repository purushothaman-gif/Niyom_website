// Marketing Tool — educational content generation (admin only).
//
// Calls the Anthropic Messages API to draft social copy for the Content
// Creation studio, then enforces NIYOM's compliance rules server-side before
// anything reaches the browser. The model is instructed at length, but the
// deterministic lint below is what actually decides whether a draft is clean —
// prompt instructions are guidance, the regex pass is the gate.
//
// This function deliberately does NOT write to mkt_content. The admin saves the
// draft from the CRM under their own JWT so RLS applies and created_by is the
// real author.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// ---------------------------------------------------------------------------
// Compliance lint. Mirrored client-side in marketingConstants.ts for live
// badges; THIS copy is authoritative.
// ---------------------------------------------------------------------------
const BANNED: { re: RegExp; label: string }[] = [
  { re: /\bbuy\s+(now|today|this|these)\b/i, label: "purchase prompt" },
  { re: /\binvest\s+(now|today|in\s+this)\b/i, label: "purchase prompt" },
  { re: /\b(guaranteed|assured|fixed)\s+returns?\b/i, label: "return promise" },
  { re: /\brisk[\s-]?free\b/i, label: "return promise" },
  { re: /\bdouble\s+your\s+money\b/i, label: "return promise" },
  { re: /\b\d+\s*%\s*(guaranteed|assured|fixed|sure)\b/i, label: "return promise" },
  { re: /\bsure\s?shot\b/i, label: "return promise" },
  { re: /\bhighest\s+returns?\b/i, label: "return promise" },
  { re: /\bbest\s+(stock|fund|scheme|bond|investment)s?\b/i, label: "recommendation" },
  { re: /\b(recommend|recommended|recommendation)\b/i, label: "recommendation" },
  { re: /\bmust[\s-]?buy\b/i, label: "recommendation" },
  { re: /\bmultibagger\b/i, label: "recommendation" },
  { re: /\bhot\s+(stock|pick|tip)s?\b/i, label: "recommendation" },
  { re: /\b(limited|last)\s+(time\s+)?offer\b/i, label: "urgency / selling" },
  { re: /\bhurry\b/i, label: "urgency / selling" },
  { re: /\bdon'?t\s+miss\s+out\b/i, label: "urgency / selling" },
  { re: /\bdm\s+(me|us)\s+to\s+invest\b/i, label: "urgency / selling" },
  { re: /\bapply\s+now\b/i, label: "urgency / selling" },
  { re: /\bbook\s+your\s+(profit|gain)s?\b/i, label: "advice" },
  { re: /\byou\s+should\s+(buy|invest|sell)\b/i, label: "advice" },
];

interface Flag { field: string; phrase: string; label: string }

function lint(draft: Record<string, unknown>): Flag[] {
  const flags: Flag[] = [];
  const scan = (field: string, value: unknown) => {
    if (!value) return;
    const text = Array.isArray(value) ? value.join(" ") : String(value);
    for (const { re, label } of BANNED) {
      const m = text.match(re);
      if (m) flags.push({ field, phrase: m[0], label });
    }
  };

  for (const f of ["title", "headline", "body", "caption", "cta"]) scan(f, draft[f]);
  scan("hashtags", draft.hashtags);
  scan("seo_keywords", draft.seo_keywords);

  for (const s of (draft.slides as { heading?: string; body?: string }[] | null) ?? []) {
    scan("slides", `${s?.heading ?? ""} ${s?.body ?? ""}`);
  }
  for (const s of (draft.video_script as { text?: string }[] | null) ?? []) {
    scan("video_script", s?.text ?? "");
  }
  return flags;
}

const REF_PLACEHOLDER = "{{REF_LINK}}";

// ---------------------------------------------------------------------------
// Prompt. Kept byte-stable so it stays cacheable — all variable context
// (topic, history) goes in the user turn.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You write educational personal-finance content for NIYOM Wealth, an AMFI-registered mutual fund distributor in India. The content is published on Instagram, Facebook and LinkedIn by NIYOM's relationship managers.

YOUR PURPOSE
Educate ordinary Indians about money. Build trust through usefulness. Nothing else.

ABSOLUTE PROHIBITIONS — a draft containing any of these is unusable:
- Never name, describe or promote any specific investment product, mutual fund, scheme, stock, bond, insurance policy or issuer.
- Never promote NIYOM's own services, products or offerings.
- Never give investment advice or make a recommendation ("you should invest in...", "the best fund is...").
- Never promise, project, imply or illustrate returns. No "guaranteed", "assured", "fixed", "risk-free", "highest returns", "double your money", no percentage return claims.
- Never use a purchase or urgency call to action: no "buy now", "invest today", "limited offer", "hurry", "don't miss out", "apply now", "DM to invest".
- Never compare products in a way that pushes the reader toward buying one.

WHAT TO WRITE INSTEAD
Explain concepts. Define terms. Show how something works. Bust a myth. Give a checklist. Share a fact or a bit of market history. Teach the reader to think, then let them decide.

TONE
Simple, clear English for an Indian audience. Warm and factual, never hypey. Use Indian context (rupees, SIP, EPF, PPF, Diwali, monsoon) where it helps comprehension. Short sentences. No jargon without a plain-English gloss.

CALL TO ACTION
The CTA must be learning-oriented only. Acceptable shapes: "Learn more about financial planning.", "Start your financial journey.", "Improve your financial knowledge.", "Take the first step towards organised finances.", "Save this for later.", "Share this with someone starting out." Never a purchase prompt.

CAPTION RULES
The caption must contain the literal token ${REF_PLACEHOLDER} exactly once. It is replaced at share time with the individual employee's onboarding link. Introduce it in an educational frame, e.g. "Learning where to begin? Start here: ${REF_PLACEHOLDER}". Never frame it as a product offer, a signup pitch or an urgent action.

UNIQUENESS
You will be given previously used titles, headlines, topics and hashtags. Your output must not repeat or closely paraphrase any of them. Pick a genuinely fresh angle, fresh wording and mostly fresh hashtags (at least 60% not in the provided list).

OUTPUT
Return only JSON matching the provided schema. Write the "body" as the text that will be typeset onto the poster itself: short, punchy, at most about 45 words. The "caption" is the longer social post copy.`;

// Structured-output schema.
//
// Deliberately conservative about which JSON Schema keywords it uses. The API's
// structured-outputs support excludes array-length constraints (minItems /
// maxItems) and string-length constraints, and because this function calls the
// REST endpoint directly rather than through an SDK, nothing strips unsupported
// keywords for us — an unsupported keyword is a 400, not a silent no-op. Counts
// are therefore requested in the prompt and enforced by the lint pass instead.
//
// Nullability uses `anyOf` rather than a `type: [X, "null"]` array, since anyOf
// is explicitly supported.
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "headline", "body", "caption", "hashtags", "cta",
    "seo_keywords", "suggested_post_time", "platform_optimisation",
    "slides", "video_script",
  ],
  properties: {
    title: { type: "string", description: "Internal reference title, max 70 characters" },
    headline: { type: "string", description: "The hero line typeset on the poster, max 110 characters" },
    body: { type: "string", description: "Supporting copy for the poster, about 45 words maximum" },
    caption: { type: "string", description: `Social post copy. Must contain ${REF_PLACEHOLDER} exactly once.` },
    hashtags: { type: "array", items: { type: "string" }, description: "Between 8 and 20 hashtags, without the # prefix" },
    cta: { type: "string", description: "Education-only call to action" },
    seo_keywords: { type: "array", items: { type: "string" }, description: "Between 5 and 10 keywords" },
    suggested_post_time: { type: "string", description: 'e.g. "19:30 IST, weekday evenings"' },
    platform_optimisation: {
      type: "object",
      additionalProperties: false,
      required: ["instagram", "facebook", "linkedin"],
      properties: {
        instagram: nullable({ type: "string" }),
        facebook: nullable({ type: "string" }),
        linkedin: nullable({ type: "string" }),
      },
    },
    slides: nullable({
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["heading", "body"],
        properties: { heading: { type: "string" }, body: { type: "string" } },
      },
    }),
    video_script: nullable({
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["scene", "text", "duration_seconds"],
        properties: {
          scene: { type: "string" },
          text: { type: "string", description: "On-screen text, at most 10 words" },
          duration_seconds: { type: "number" },
        },
      },
    }),
  },
};

function buildUserMessage(body: Record<string, unknown>, history: string): string {
  const type = String(body.content_type ?? "poster");
  const parts: string[] = [
    `Category: ${body.category}`,
    body.topic ? `Specific topic: ${body.topic}` : `Specific topic: (choose a strong one within the category)`,
    `Content type: ${type}`,
    `Platforms: ${(body.platforms as string[] ?? []).join(", ") || "instagram"}`,
  ];

  if (body.tone) parts.push(`Tone: ${body.tone}`);
  if (body.extra_instructions) parts.push(`Extra instructions from the admin: ${body.extra_instructions}`);

  if (type === "carousel" || type === "infographic") {
    parts.push(`Produce exactly ${body.slide_count ?? 5} slides in "slides". Slide 1 is the hook; the last slide closes with the educational CTA. Set "video_script" to null.`);
  } else {
    parts.push(`Set "slides" to null.`);
  }

  if (["short_video", "animated_poster", "motion_graphic"].includes(type)) {
    const dur = body.video_duration_seconds ?? 30;
    parts.push(`Produce a "video_script" whose scene durations sum to about ${dur} seconds. Each scene's on-screen text must be at most 10 words.`);
  } else {
    parts.push(`Set "video_script" to null.`);
  }

  if (body.regenerate_of_content_no) {
    parts.push(`This is a REGENERATION of ${body.regenerate_of_content_no}. Take a distinctly different angle — different opening, different structure, different examples.`);
  }

  parts.push(history
    ? `\n<previously_used>\nDo not repeat or closely paraphrase any of these:\n${history}\n</previously_used>`
    : `\n<previously_used>(nothing yet — this is the first piece in this category)</previously_used>`);

  return parts.join("\n");
}

/** Recent titles/headlines/hashtags, for the uniqueness contract. */
async function loadHistory(admin: ReturnType<typeof createClient>, category: string): Promise<string> {
  const lines: string[] = [];

  const [{ data: hist }, { data: live }] = await Promise.all([
    admin.from("mkt_content_history")
      .select("title, headline, topic, hashtags")
      .eq("category", category)
      .order("deleted_at", { ascending: false })
      .limit(100),
    admin.from("mkt_content")
      .select("title, headline, topic, hashtags")
      .eq("category", category)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  for (const row of [...(live ?? []), ...(hist ?? [])] as Record<string, unknown>[]) {
    const tags = Array.isArray(row.hashtags) ? (row.hashtags as string[]).slice(0, 8).join(" ") : "";
    lines.push(`- "${row.title}" | ${row.headline} | topic: ${row.topic} | ${tags}`);
  }
  return lines.slice(0, 100).join("\n");
}

/** Jaccard overlap between two hashtag sets. */
function tagOverlap(a: string[], b: string[]): number {
  const norm = (t: string) => t.replace(/^#/, "").toLowerCase();
  const A = new Set(a.map(norm));
  const B = new Set(b.map(norm));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / new Set([...A, ...B]).size;
}

async function callAnthropic(apiKey: string, messages: { role: string; content: string }[]) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      // max_tokens caps thinking AND response text together. Adaptive thinking
      // is on by default on this model, so a budget sized only for the JSON
      // would truncate mid-object once the model thinks — which surfaces as
      // stop_reason "max_tokens" and loses the whole generation. A carousel
      // draft with 10 slides plus a video script is the worst case; 16000
      // leaves comfortable room for it alongside the reasoning.
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      // Thinking is stated explicitly rather than relied on as a default, and
      // its content is left omitted — nothing here surfaces reasoning to a UI.
      thinking: { type: "adaptive" },
      // Guarantees schema-valid JSON. Note: this model REJECTS non-default
      // temperature / top_p / top_k with a 400, so none of them are sent.
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: DRAFT_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 500)}`);
  }

  const payload = await res.json();

  if (payload.stop_reason === "refusal") {
    throw new Error("The model declined to generate this content. Try a different topic or wording.");
  }
  if (payload.stop_reason === "max_tokens") {
    throw new Error("Generation was cut off before completing. Try a shorter format or fewer slides.");
  }

  const text = (payload.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  if (!text.trim()) throw new Error("The model returned an empty response.");

  let draft: Record<string, unknown>;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error("The model returned malformed JSON.");
  }
  return { draft, usage: payload.usage };
}

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
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!apiKey) {
      return json({
        error: "Content generation is not configured yet. An administrator needs to set the ANTHROPIC_API_KEY secret for this project.",
      }, 503);
    }

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

    const history = await loadHistory(admin, String(body.category));
    const userMessage = buildUserMessage(body, history);

    const messages = [{ role: "user", content: userMessage }];
    let { draft, usage } = await callAnthropic(apiKey, messages);
    let flags = lint(draft);

    // Placeholder is structural — the copy button depends on it.
    const captionText = String(draft.caption ?? "");
    const placeholderCount = captionText.split(REF_PLACEHOLDER).length - 1;
    if (placeholderCount !== 1) {
      flags.push({
        field: "caption",
        phrase: placeholderCount === 0 ? "(missing referral link placeholder)" : "(duplicate referral link placeholder)",
        label: "structure",
      });
    }

    // Array lengths are asked for in the schema descriptions rather than
    // enforced by minItems/maxItems (unsupported by structured outputs), so
    // they are checked here instead. Out-of-range counts are a flag, not a
    // hard failure — the admin can add or trim tags by hand.
    const hashtagCount = Array.isArray(draft.hashtags) ? draft.hashtags.length : 0;
    if (hashtagCount < 8 || hashtagCount > 20) {
      flags.push({ field: "hashtags", phrase: `(${hashtagCount} hashtags, expected 8-20)`, label: "structure" });
    }
    const keywordCount = Array.isArray(draft.seo_keywords) ? draft.seo_keywords.length : 0;
    if (keywordCount < 5 || keywordCount > 10) {
      flags.push({ field: "seo_keywords", phrase: `(${keywordCount} keywords, expected 5-10)`, label: "structure" });
    }

    // One corrective retry, quoting the exact violations.
    if (flags.length) {
      const complaints = flags
        .map(f => `- ${f.field}: "${f.phrase}" (${f.label})`)
        .join("\n");

      messages.push({ role: "assistant", content: JSON.stringify(draft) });
      messages.push({
        role: "user",
        content:
          `That draft breaks the rules in these places:\n${complaints}\n\n` +
          `Rewrite it completely. Remove every flagged phrase and anything similar. ` +
          `Keep it purely educational, keep the caption's single ${REF_PLACEHOLDER} token, ` +
          `and do not reintroduce any promise, recommendation or purchase prompt.`,
      });

      try {
        const retry = await callAnthropic(apiKey, messages);
        const retryFlags = lint(retry.draft);
        const retryCaption = String(retry.draft.caption ?? "");
        if (retryCaption.split(REF_PLACEHOLDER).length - 1 !== 1) {
          retryFlags.push({ field: "caption", phrase: "(referral link placeholder)", label: "structure" });
        }
        // Keep the retry only if it is actually cleaner.
        if (retryFlags.length < flags.length) {
          draft = retry.draft;
          flags = retryFlags;
          usage = retry.usage;
        }
      } catch {
        // Retry failed — fall through and return the first draft with its flags
        // so the admin can fix it by hand rather than losing the work.
      }
    }

    // Soft uniqueness check against live content in the same category.
    const { data: recent } = await admin
      .from("mkt_content")
      .select("title, headline, hashtags")
      .eq("category", body.category)
      .limit(100);

    const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
    for (const row of (recent ?? []) as Record<string, unknown>[]) {
      if (norm(row.title) === norm(draft.title) || norm(row.headline) === norm(draft.headline)) {
        flags.push({ field: "title", phrase: String(draft.title), label: "duplicate of existing content" });
        break;
      }
      if (tagOverlap((draft.hashtags as string[]) ?? [], (row.hashtags as string[]) ?? []) > 0.8) {
        flags.push({ field: "hashtags", phrase: "(near-identical hashtag set)", label: "duplicate of existing content" });
        break;
      }
    }

    return json({
      success: true,
      draft,
      lint: { passed: flags.length === 0, flagged: flags },
      usage: usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } : undefined,
      model: ANTHROPIC_MODEL,
    });
  } catch (err) {
    console.error("mkt-generate-content failed:", err);
    return json({ error: err instanceof Error ? err.message : "Content generation failed" }, 500);
  }
});
