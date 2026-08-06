// Marketing Tool — hard deletion of marketing content.
//
// Two entry points, one implementation, because both must do exactly the same
// cleanup:
//   { source: "cron" }                      -> sweep everything past expires_at
//   { source: "admin", content_id, note }   -> delete one item immediately
//
// Deletion is genuinely destructive by requirement: the copy and every rendered
// poster/video are removed from the database and from storage with no backup
// and no recycle bin. Two things deliberately survive, and neither is
// publishable: a slim mkt_content_history row (title/category/hashtags/counts)
// so the generator can avoid repeating topics and the analytics stay truthful,
// and an entry in mkt_deletion_logs.
//
// The cron path runs with verify_jwt=false so pg_cron can reach it via pg_net.
// That is safe by construction: it only ever deletes rows that are already past
// their expiry, i.e. work the schedule would do minutes later anyway. The admin
// path inside the same function independently requires an admin JWT.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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

const BUCKET = "marketing-content";
const BATCH_LIMIT = 50;

interface ContentRow {
  id: string;
  content_no: string;
  category: string;
  topic: string;
  content_type: string;
  platforms: string[];
  title: string;
  headline: string;
  hashtags: string[];
  status: string;
  created_by: string | null;
  created_at: string;
  approved_at: string | null;
}

/**
 * Purge one piece of content.
 *
 * Ordering matters: history and logs are written first, then storage objects
 * are removed, and only then is the row deleted. If storage removal fails we
 * abort THIS item and leave its row in place, so the next sweep retries it —
 * that way we can never end up with orphaned files whose owning row is gone.
 */
async function purge(
  db: SupabaseClient,
  content: ContentRow,
  reason: "expired" | "admin_deleted",
  deletedBy: string | null,
  note: string,
): Promise<{ ok: true; assets: number } | { ok: false; error: string }> {
  // How much use did this get? Recorded before the row disappears.
  const { count: downloadCount } = await db
    .from("mkt_downloads")
    .select("id", { count: "exact", head: true })
    .eq("content_no", content.content_no)
    .in("event_type", ["download_poster", "download_video"]);

  const { data: assets } = await db
    .from("mkt_content_assets")
    .select("storage_path")
    .eq("content_id", content.id);

  const paths = (assets ?? []).map((a: { storage_path: string }) => a.storage_path);

  // 1. Slim survivor row. ON CONFLICT-equivalent so a retried sweep is a no-op.
  const { error: histErr } = await db.from("mkt_content_history").upsert([{
    content_no: content.content_no,
    category: content.category,
    topic: content.topic,
    content_type: content.content_type,
    platforms: content.platforms ?? [],
    title: content.title,
    headline: content.headline,
    hashtags: content.hashtags ?? [],
    final_status: content.status,
    download_count: downloadCount ?? 0,
    created_by: content.created_by,
    created_at: content.created_at,
    approved_at: content.approved_at,
    deleted_at: new Date().toISOString(),
    delete_reason: reason,
  }], { onConflict: "content_no" });

  if (histErr) return { ok: false, error: `history: ${histErr.message}` };

  // 2. Deletion log + audit event.
  await db.from("mkt_deletion_logs").insert([{
    content_no: content.content_no,
    deleted_by: deletedBy,
    reason: note || (reason === "expired" ? "Expired 48h after going live" : "Deleted by admin"),
    assets_deleted: paths,
  }]);

  await db.from("mkt_approval_events").insert([{
    content_id: content.id,
    content_no: content.content_no,
    action: reason === "expired" ? "expired" : "deleted",
    actor_employee_id: deletedBy,
    note,
  }]);

  // 3. Storage. Removing paths that are already gone is a no-op, so a retry is
  //    harmless; a genuine failure aborts before the row is deleted.
  if (paths.length) {
    const { error: storageErr } = await db.storage.from(BUCKET).remove(paths);
    if (storageErr) return { ok: false, error: `storage: ${storageErr.message}` };
  }

  // 4. The row itself. Cascades mkt_content_assets; mkt_downloads and
  //    mkt_approval_events null their FK but keep the denormalised content_no.
  const { error: delErr } = await db.from("mkt_content").delete().eq("id", content.id);
  if (delErr) return { ok: false, error: `delete: ${delErr.message}` };

  return { ok: true, assets: paths.length };
}

const CONTENT_COLUMNS =
  "id, content_no, category, topic, content_type, platforms, title, headline, " +
  "hashtags, status, created_by, created_at, approved_at";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* cron may post an empty body */ }
    const source = String(body.source ?? "cron");

    // ---------------------------------------------------------------- admin
    if (source === "admin") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Unauthorized" }, 401);

      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userErr } = await callerClient.auth.getUser();
      if (userErr || !user) return json({ error: "Unauthorized" }, 401);

      const { data: caller } = await db
        .from("nw_employees")
        .select("id, role, status")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      const authorised = caller
        && ["admin", "super_admin"].includes(caller.role as string)
        && caller.status === "active";
      if (!authorised) return json({ error: "Forbidden: admin access required" }, 403);

      const contentId = String(body.content_id ?? "");
      if (!contentId) return json({ error: "content_id is required" }, 400);

      const { data: content } = await db
        .from("mkt_content").select(CONTENT_COLUMNS).eq("id", contentId).maybeSingle();

      // Already gone — treat as success so a double-click is not an error.
      if (!content) return json({ success: true, processed: 0, already_deleted: true });

      const result = await purge(
        db, content as unknown as ContentRow, "admin_deleted",
        (caller as { id: string }).id, String(body.note ?? ""),
      );
      if (!result.ok) return json({ error: result.error }, 500);

      return json({ success: true, processed: 1, assets_removed: result.assets });
    }

    // ----------------------------------------------------------------- cron
    const { data: due, error: dueErr } = await db
      .from("mkt_content")
      .select(CONTENT_COLUMNS)
      .eq("status", "approved")
      .lte("expires_at", new Date().toISOString())
      .limit(BATCH_LIMIT);

    if (dueErr) return json({ error: dueErr.message }, 500);

    const failed: { content_no: string; error: string }[] = [];
    let processed = 0;

    for (const row of (due ?? []) as unknown as ContentRow[]) {
      const result = await purge(db, row, "expired", null, "");
      if (result.ok) processed++;
      else failed.push({ content_no: row.content_no, error: result.error });
    }

    if (failed.length) {
      console.error("mkt-expire-content: some items could not be purged", failed);
    }

    return json({ success: true, processed, failed, batch_size: (due ?? []).length });
  } catch (err) {
    console.error("mkt-expire-content failed:", err);
    return json({ error: err instanceof Error ? err.message : "Expiry sweep failed" }, 500);
  }
});
