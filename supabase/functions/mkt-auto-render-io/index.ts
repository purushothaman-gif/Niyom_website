// Automated daily content — the render worker's only door into this project.
//
// ## Why this function exists at all
//
// The render worker runs in GitHub Actions. The obvious design gives that
// workflow the service-role key, which grants unrestricted read and write over
// every table and bucket — making every repo collaborator, and every action in
// the workflow's dependency chain, a de-facto database superuser. Given this
// project's history that was not an acceptable default.
//
// So the worker gets a capability token instead. This function exposes exactly
// four verbs — claim work, mint upload URLs, finalize, fail — and nothing else.
// A stolen MKT_RENDER_SECRET lets an attacker render posters for content that
// already exists. It does not let them read a client record, spend Anthropic
// tokens (that is a DIFFERENT secret, deliberately), or write anything outside
// mkt_content_assets.
//
// The upload URLs are signed and per-object, so the binaries go straight to
// storage rather than through here — this function never handles a payload
// larger than a JSON manifest.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { entityLeakageFlags, lint, structuralFlags } from "../_shared/mkt/compliance.ts";
import type { Flag } from "../_shared/mkt/types.ts";
import type { Json } from "../_shared/database.types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-mkt-render-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BUCKET = "marketing-content";

/** Constant-time compare, so a wrong secret cannot be narrowed a byte at a time. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

interface AssetManifest {
  variant: string;
  kind: "image" | "video";
  storage_path: string;
  width: number;
  height: number;
  duration_seconds?: number | null;
  file_size: number;
  mime_type: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const expected = Deno.env.get("MKT_RENDER_SECRET")?.trim();
    const given = req.headers.get("x-mkt-render-secret");
    if (!expected || !given || !secretMatches(given, expected)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    // -----------------------------------------------------------------------
    switch (action) {
      case "claim": {
        const runDate = body?.run_date || istToday();
        const { data: slots, error } = await db.rpc("mkt_auto_claim_render", {
          p_run_date: runDate,
          p_limit: Math.min(3, body?.limit ?? 3),
        });
        if (error) throw error;

        const items = [];
        for (const s of (slots ?? []) as Record<string, unknown>[]) {
          const { data: content } = await db
            .from("mkt_content")
            .select("id, content_no, content_type, category, headline, body, cta, template_id, design_spec")
            .eq("id", s.content_id as string)
            .maybeSingle();

          // The row can be gone if an admin deleted it between generation and
          // render. Fail the slot rather than the whole batch.
          if (!content) {
            await db.rpc("mkt_auto_render_failed", {
              // s.id comes back as unknown from the generic RPC row shape.
              p_slot_id: s.id as string, p_error: "content row no longer exists",
            });
            continue;
          }

          const spec = (content.design_spec ?? {}) as Record<string, unknown>;
          items.push({
            slot_id: s.id,
            slot_no: s.slot_no,
            content_id: content.id,
            content_no: content.content_no,
            content_type: content.content_type,
            category: content.category,
            headline: content.headline,
            body: content.body,
            cta: content.cta,
            template_id: content.template_id,
            // design_spec stores JSON null (not an absent key) for the shape a
            // given content type does not use, so normalise here rather than
            // making every caller re-derive it.
            palette_id: String(spec.paletteId ?? "midnightGold"),
            slides: Array.isArray(spec.slides) ? spec.slides : null,
            video_script: Array.isArray(spec.video_script) ? spec.video_script : null,
          });
        }
        return json({ ok: true, run_date: runDate, items });
      }

      // -----------------------------------------------------------------------
      case "upload-urls": {
        const contentId = String(body?.content_id ?? "");
        const variants = (body?.variants ?? []) as { variant: string; ext: string }[];
        if (!contentId || !variants.length) return json({ error: "content_id and variants are required" }, 400);

        const urls = [];
        for (const v of variants) {
          // Same path convention as useUploadAsset in marketingClient.ts, so
          // auto and manual assets are indistinguishable to AssetPreview and to
          // mkt-expire-content's storage cleanup.
          const path = `content/${contentId}/${v.variant}.${v.ext}`;
          const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
          if (error) throw error;
          urls.push({ variant: v.variant, path, signed_url: data.signedUrl, token: data.token });
        }
        return json({ ok: true, urls });
      }

      // -----------------------------------------------------------------------
      case "finalize": {
        const slotId = String(body?.slot_id ?? "");
        const contentId = String(body?.content_id ?? "");
        const assets = (body?.assets ?? []) as AssetManifest[];
        if (!slotId || !contentId) return json({ error: "slot_id and content_id are required" }, 400);

        if (assets.length) {
          const { error } = await db.from("mkt_content_assets").upsert(
            assets.map(a => ({
              content_id: contentId,
              variant: a.variant,
              kind: a.kind,
              storage_path: a.storage_path,
              width: a.width,
              height: a.height,
              duration_seconds: a.duration_seconds ?? null,
              file_size: a.file_size,
              mime_type: a.mime_type,
            })),
            { onConflict: "content_id,variant" },
          );
          if (error) throw error;
        }

        /*
          Re-lint the row as STORED, not the draft the generator held in memory.
          Between generation and here an admin may have edited the copy, and the
          approval decision must be made about what is actually going out. This
          is also the only lint that stands between a batch and the gallery once
          auto-approval is on.
        */
        const { data: row } = await db
          .from("mkt_content")
          .select("*")
          .eq("id", contentId)
          .maybeSingle();
        if (!row) return json({ error: "content row no longer exists" }, 404);

        const meta = (row.generation_meta ?? {}) as Record<string, unknown>;
        const trendTitles = Array.isArray(meta.trends) ? (meta.trends as string[]) : [];
        const flags: Flag[] = [
          ...lint(row as Record<string, unknown>),
          ...structuralFlags(row as Record<string, unknown>),
          ...entityLeakageFlags(row as Record<string, unknown>, trendTitles),
        ];

        const { data: settings } = await db
          .from("mkt_auto_settings")
          .select("auto_approve, approve_window_hours")
          .eq("id", true)
          .maybeSingle();

        const autoApprove = settings?.auto_approve === true;
        const hours = settings?.approve_window_hours ?? 72;

        let state = flags.length ? "flagged" : "rendered";
        let approved = false;

        if (!flags.length && autoApprove && row.status === "draft") {
          const { error } = await db.rpc("mkt_auto_approve", {
            p_content_id: contentId,
            p_note: `auto-approved: lint clean, ${assets.length} assets rendered`,
            p_hours: hours,
          });
          if (error) throw error;
          state = "approved";
          approved = true;
        }

        await db.rpc("mkt_auto_finish_slot", {
          p_slot_id: slotId,
          p_state: state,
          p_content_id: contentId,
          // Flag[] is structurally JSON, but the generated Json union is
          // recursive and does not accept an interface with named fields
          // without being told they are the same thing.
          p_flags: flags as unknown as Json,
        });

        if (flags.length) {
          await db.rpc("mkt_auto_alert_admins", {
            p_title: `Auto content needs review — ${row.content_no}`,
            p_message:
              `${row.content_no} (${row.category}) rendered with ${flags.length} ` +
              `issue${flags.length === 1 ? "" : "s"}: ${flags.map(f => `${f.field} — ${f.label}`).join("; ")}. ` +
              `Artwork is ready; the copy needs a fix before it can go live.`,
          });
        }

        await db.rpc("mkt_auto_batch_rollup", { p_run_date: row.scheduled_publish_at
          ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })
              .format(new Date(row.scheduled_publish_at as string))
          : istToday() });

        return json({
          ok: true, content_no: row.content_no, state, approved,
          assets: assets.length, flags,
          auto_approve_enabled: autoApprove,
        });
      }

      // -----------------------------------------------------------------------
      case "fail": {
        const slotId = String(body?.slot_id ?? "");
        if (!slotId) return json({ error: "slot_id is required" }, 400);
        const { data, error } = await db.rpc("mkt_auto_render_failed", {
          p_slot_id: slotId,
          p_error: String(body?.error ?? "render failed"),
        });
        if (error) throw error;
        return json({ ok: true, state: data });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("mkt-auto-render-io failed:", err);
    return json({ error: err instanceof Error ? err.message : "Render IO failed" }, 500);
  }
});
