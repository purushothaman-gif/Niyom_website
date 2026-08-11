// Automated daily content — generation.
//
// Takes the day's planned slots (see 20260812090000_mkt_auto_schedule.sql),
// writes copy for each through the same pipeline the manual studio uses, and
// saves the result as a DRAFT. It does not approve anything and it does not
// render artwork; those are the render worker's job.
//
// ## Auth: a vault-held shared secret, not an open endpoint
//
// mkt-expire-content is safe to leave open because the worst an anonymous
// caller achieves is deleting rows already past their expiry — work the
// schedule does minutes later anyway. This one spends Anthropic tokens and
// creates content that gets published under the firm's brand, so an open
// endpoint would be both a billing DoS and a content-injection vector.
//
// An admin JWT is accepted too, which is what powers "Run now" and "Regenerate
// this slot" in the CRM.
//
// ## Deadline and resume
//
// Three sequential generations at effort:medium with adaptive thinking run
// 20-45s each, and a corrective retry pushes past 200s — too long for one
// comfortable invocation. So it claims at most `max_slots` (default 2), stops
// at an internal deadline, and reports what is left. The cron fires repeatedly
// across a 25-minute window and each tick is a no-op once the day is done.
//
// Two per call rather than one is deliberate: back-to-back calls land inside
// Anthropic's prompt cache window, which one-every-five-minutes would miss.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveApiKey } from "../_shared/mkt/anthropic.ts";
import { generateDraft } from "../_shared/mkt/generate.ts";
import { loadCategoryTopics, loadRecentAcrossCategories } from "../_shared/mkt/history.ts";
import { loadTrends } from "../_shared/mkt/trends.ts";
import { sbInsertOne, sbRpc } from "../_shared/mkt/db.ts";
import { sbSelect } from "../_shared/cas/db.ts";
import type { SbConfig } from "../_shared/cas/db.ts";
import type { Flag, TrendItem } from "../_shared/mkt/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-mkt-auto-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Leaves room to finish the slot in flight and write its row before the
 *  platform's wall-clock limit cuts the invocation off mid-insert. */
const DEADLINE_MS = 110_000;

interface Slot {
  id: string;
  run_date: string;
  slot_no: number;
  content_type: string;
  platform: string;
  category: string;
  template_id: string;
  palette_id: string;
  slide_count: number | null;
  video_duration_seconds: number | null;
}

/** Today in IST — the batch calendar is Indian business days. */
function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/**
 * Timing-safe comparison, so a wrong secret cannot be narrowed a byte at a time.
 * Length is compared first and separately; that leaks only the length, which is
 * not secret.
 */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function authorise(req: Request, cfg: SbConfig, anonKey: string): Promise<string | null> {
  const secret = Deno.env.get("MKT_AUTO_SECRET")?.trim();
  const given = req.headers.get("x-mkt-auto-secret");
  if (secret && given && secretMatches(given, secret)) return null;

  // Admin JWT path — the CRM's "Run now" / "Regenerate slot" buttons.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return "Unauthorized";

  const caller = createClient(cfg.supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await caller.auth.getUser();
  if (error || !user) return "Unauthorized";

  const admin = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey!);
  const { data: emp } = await admin
    .from("nw_employees")
    .select("role, status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const ok = emp && ["admin", "super_admin"].includes(emp.role as string) && emp.status === "active";
  return ok ? null : "Forbidden: admin access required";
}

/** The row saved to mkt_content, in exactly the shape ContentStudio writes. */
function contentRow(
  slot: Slot,
  draft: Record<string, unknown>,
  meta: Record<string, unknown>,
  publishAt: string,
) {
  return {
    content_type: slot.content_type,
    platforms: [slot.platform],
    category: slot.category,
    topic: String(draft.topic ?? draft.title ?? "").slice(0, 300),
    title: String(draft.title ?? ""),
    headline: String(draft.headline ?? ""),
    body: String(draft.body ?? ""),
    caption: String(draft.caption ?? ""),
    hashtags: (draft.hashtags as string[]) ?? [],
    cta: String(draft.cta ?? ""),
    seo_keywords: (draft.seo_keywords as string[]) ?? [],
    suggested_post_time: String(draft.suggested_post_time ?? ""),
    platform_notes: draft.platform_optimisation ?? {},
    template_id: slot.template_id,
    // Same key names ContentStudio uses, so the renderer and AssetPreview read
    // auto and manual content through one code path.
    design_spec: {
      paletteId: slot.palette_id,
      slides: draft.slides ?? null,
      video_script: draft.video_script ?? null,
    },
    generation_meta: meta,
    status: "draft",
    // No employee owns this. created_by is already nullable and NULL already
    // means exactly that — a synthetic "system" employee would have to be
    // special-cased in auth, the directory, RM assignment and the leaderboard.
    created_by: null,
    // The existing RLS predicate, not any new code, is what keeps the batch
    // invisible to employees until 09:30 IST.
    scheduled_publish_at: publishAt,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const started = Date.now();

  try {
    const cfg: SbConfig = {
      supabaseUrl: Deno.env.get("SUPABASE_URL")!,
      supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    };
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const denied = await authorise(req, cfg, anonKey);
    if (denied) return json({ error: denied }, denied === "Unauthorized" ? 401 : 403);

    const key = resolveApiKey(Deno.env.get("ANTHROPIC_API_KEY"));
    if ("error" in key) return json({ error: key.error }, 503);

    const body = await req.json().catch(() => ({}));
    const runDate: string = body?.run_date || istToday();
    const slotNo: number | null = body?.slot_no ?? null;
    const force: boolean = body?.force === true;
    const dryRun: boolean = body?.dry_run === true;
    const maxSlots: number = Math.max(1, Math.min(3, body?.max_slots ?? 2));

    const claimed = await sbRpc<Slot[]>(cfg, "mkt_auto_claim_slots", {
      p_run_date: runDate,
      p_limit: dryRun ? 1 : maxSlots,
      p_slot_no: slotNo,
      p_force: force || dryRun,
    });

    if (!claimed.length) {
      return json({ ok: true, run_date: runDate, processed: 0, remaining: 0, slots: [], note: "nothing to claim" });
    }

    // One news fetch per invocation, shared by every slot in it.
    const trends: TrendItem[] = await loadTrends(cfg);
    const recent = await loadRecentAcrossCategories(cfg);

    const publishAt = new Date(`${runDate}T04:00:00.000Z`).toISOString();   // 09:30 IST
    const results: Record<string, unknown>[] = [];

    for (const slot of claimed) {
      if (Date.now() - started > DEADLINE_MS) {
        // Hand the slot back rather than leaving it stuck in 'generating'.
        // release, not finish: the model was never called, so this must not
        // consume one of the slot's two attempts.
        await sbRpc(cfg, "mkt_auto_release_slot", {
          p_slot_id: slot.id, p_note: "deferred past invocation deadline",
        });
        break;
      }

      try {
        const topics = await loadCategoryTopics(cfg, slot.category);

        const result = await generateDraft({
          cfg,
          apiKey: key.key,
          brief: {
            category: slot.category,
            content_type: slot.content_type,
            platforms: [slot.platform],
            slide_count: slot.slide_count ?? undefined,
            video_duration_seconds: slot.video_duration_seconds ?? undefined,
          },
          trends,
          uniqueness: { recent, topics },
          duplicateMode: "hard",
        });

        if (dryRun) {
          results.push({
            slot_no: slot.slot_no, category: slot.category, content_type: slot.content_type,
            platform: slot.platform, draft: result.draft, flags: result.flags, usage: result.usage,
          });
          // Put the slot back exactly as it was found, retry budget included.
          await sbRpc(cfg, "mkt_auto_release_slot", { p_slot_id: slot.id });
          continue;
        }

        const meta = {
          model: result.model,
          source: "auto",
          run_date: runDate,
          slot_no: slot.slot_no,
          lint_findings: result.flags.length,
          // The exact sanitised headlines that shaped this draft, so bad output
          // is traceable to the input that produced it.
          trends: trends.map(t => t.title),
          usage: result.usage ?? null,
        };

        const row = await sbInsertOne<{ id: string; content_no: string }>(
          cfg, "mkt_content", contentRow(slot, result.draft, meta, publishAt),
        );

        await sbInsertOne(cfg, "mkt_approval_events", {
          content_id: row.id,
          content_no: row.content_no,
          action: "generated",
          actor_employee_id: null,
          note: `auto batch ${runDate} slot ${slot.slot_no}`,
        });

        // Flagged content still gets saved as a draft — losing the work helps
        // nobody, and an admin can fix a phrase far faster than a regeneration.
        const flagged = result.flags.length > 0;
        await sbRpc(cfg, "mkt_auto_finish_slot", {
          p_slot_id: slot.id,
          p_state: flagged ? "flagged" : "generated",
          p_content_id: row.id,
          p_flags: result.flags,
        });

        if (flagged) {
          await sbRpc(cfg, "mkt_auto_alert_admins", {
            p_title: `Auto content needs review — ${row.content_no}`,
            p_message:
              `${runDate} slot ${slot.slot_no} (${slot.platform} · ${slot.category}) was generated ` +
              `with ${result.flags.length} issue${result.flags.length === 1 ? "" : "s"}: ` +
              `${result.flags.map((f: Flag) => `${f.field} — ${f.label}`).join("; ")}. ` +
              `It is saved as a draft and will not go live until an admin clears it.`,
          });
        }

        results.push({
          slot_no: slot.slot_no, state: flagged ? "flagged" : "generated",
          content_no: row.content_no, flags: result.flags, usage: result.usage,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`mkt-auto-generate slot ${runDate}/${slot.slot_no} failed:`, message);
        if (dryRun) {
          await sbRpc(cfg, "mkt_auto_release_slot", { p_slot_id: slot.id }).catch(() => {});
        } else {
          await sbRpc(cfg, "mkt_auto_finish_slot", {
            p_slot_id: slot.id, p_state: "failed", p_error: message.slice(0, 500),
          });
        }
        results.push({ slot_no: slot.slot_no, state: "failed", error: message.slice(0, 300) });
      }
    }

    let remaining = 0;
    if (!dryRun) {
      await sbRpc(cfg, "mkt_auto_batch_rollup", { p_run_date: runDate });
      // A plain read, not another claim — calling the claim function to count
      // would move rows into 'generating' that nothing is about to generate.
      const left = await sbSelect<{ id: string }>(
        cfg,
        `mkt_auto_slots?select=id&run_date=eq.${runDate}&state=in.(planned,failed)&regen_count=lt.2`,
      ).catch(() => []);
      remaining = left.length;
    }

    return json({
      ok: true,
      run_date: runDate,
      dry_run: dryRun,
      processed: results.length,
      remaining,
      trends_used: trends.length,
      slots: results,
      elapsed_ms: Date.now() - started,
    });
  } catch (err) {
    console.error("mkt-auto-generate failed:", err);
    return json({ error: err instanceof Error ? err.message : "Automated generation failed" }, 500);
  }
});
