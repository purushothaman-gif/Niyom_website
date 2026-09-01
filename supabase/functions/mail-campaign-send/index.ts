// Send a campaign: one test to yourself, or the real blast.
//
// The hard part of bulk mail is not sending — it is being certain that nobody
// is sent two copies and nobody is silently skipped. That guarantee lives in
// the database, not here:
//
//   - mail_begin_send materialises the audience into a real outbox table, once,
//     idempotently. Resuming re-runs it and adds nothing.
//   - mail_claim_recipients hands out work with FOR UPDATE SKIP LOCKED, so two
//     of these functions running at the same time (a retry, a double click,
//     two admins) take disjoint rows rather than the same ones.
//   - UNIQUE (campaign_id, lower(email)) means even a bug cannot deliver twice.
//
// So this function is deliberately dumb: claim a chunk, render, hand it to
// Resend, record what happened, repeat until the clock runs out. It returns
// `remaining` and the browser calls it again. An interrupted send therefore
// leaves a resumable queue rather than an unknown state — which is the whole
// reason it is not one long-running request.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseBlocks } from "../_shared/mail/blocks.ts";
import { campaignContentHash, renderCampaign } from "../_shared/mail/render.ts";

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

const FROM = "Niyom Wealth <support@niyomwealth.com>";
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";

// Resend's batch endpoint takes 100 per call. Stopping at 110s leaves headroom
// inside the edge runtime's wall clock for the final bookkeeping write — a
// batch that sent but was never recorded would be re-sent on resume, which is
// exactly the failure this whole design exists to avoid.
const BATCH_SIZE = 100;
const DEADLINE_MS = 110_000;

interface ClaimedRow {
  id: string;
  email: string;
  full_name: string;
  merge: Record<string, string>;
  unsub_token: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return json({ error: "Email sending is not configured: RESEND_API_KEY is not set." }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "https://www.niyomwealth.com").replace(/\/$/, "");
    const functionsUrl = `${supabaseUrl}/functions/v1`;

    // Identify under the caller's own JWT, authorise with the service role.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !callerUser) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: caller } = await admin
      .from("nw_employees")
      .select("id, role, status, email, full_name")
      .eq("auth_user_id", callerUser.id)
      .maybeSingle();

    if (!caller || caller.status !== "active" || !["admin", "super_admin"].includes(caller.role)) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({})) as { campaignId?: string; mode?: string };
    const campaignId = String(body.campaignId ?? "");
    const mode = body.mode === "live" ? "live" : "test";
    if (!campaignId) return json({ error: "campaignId is required" }, 400);

    const { data: campaign, error: cErr } = await admin
      .from("mail_campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();
    if (cErr || !campaign) return json({ error: "Unknown campaign." }, 404);

    const blocks = parseBlocks(campaign.blocks);
    const shape = {
      subject: campaign.subject as string,
      preheader: campaign.preheader as string,
      blocks,
      audience: campaign.audience as "client" | "partner",
      ctaPortalEnabled: campaign.cta_portal_enabled as boolean,
      ctaPortalLabel: campaign.cta_portal_label as string,
    };

    // Recomputed here rather than trusted from the row: the hash is the gate,
    // and a gate you let the caller supply the key to is not a gate.
    const contentHash = await campaignContentHash(shape);

    // Every RPC below runs as the calling admin, so the admin checks inside
    // them apply and the audit trail records a real person.
    const rpc = callerClient.rpc.bind(callerClient);

    // -----------------------------------------------------------------------
    // Test mode: exactly one mail, to the caller's own registered address.
    // Never an address from the request body — a "test send" that could be
    // pointed anywhere is just an unaudited send with a friendlier name.
    // -----------------------------------------------------------------------
    if (mode === "test") {
      const to = String(caller.email ?? "").trim();
      if (!to) return json({ error: "Your employee record has no email address to test with." }, 400);

      const { html, text } = renderCampaign({
        ...shape,
        appUrl,
        merge: {
          full_name: String(caller.full_name ?? "Test Recipient"),
          first_name: String(caller.full_name ?? "Test").split(" ")[0],
          code: "TEST-0000",
        },
        unsubscribeUrl: `${functionsUrl}/mail-unsubscribe?t=preview-token-not-a-real-unsubscribe`,
      });

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [to],
          subject: `[TEST] ${campaign.subject}`,
          html,
          text,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        return json({ error: "Resend rejected the test email.", detail: payload }, 502);
      }

      // Stamp the hash of what was ACTUALLY sent. The approve gate compares
      // against the campaign's current hash, so editing after this point
      // invalidates the test instead of quietly passing it.
      const { error: stampErr } = await rpc("mail_record_test_send", {
        p_campaign_id: campaignId,
        p_hash: contentHash,
      });
      if (stampErr) return json({ error: stampErr.message }, 400);

      return json({ ok: true, mode: "test", sentTo: to, contentHash });
    }

    // -----------------------------------------------------------------------
    // Live mode.
    // -----------------------------------------------------------------------
    const { data: begun, error: beginErr } = await rpc("mail_begin_send", { p_campaign_id: campaignId });
    if (beginErr) return json({ error: beginErr.message }, 400);

    let sent = 0;
    let failed = 0;

    while (Date.now() - startedAt < DEADLINE_MS) {
      const { data: claimed, error: claimErr } = await rpc("mail_claim_recipients", {
        p_campaign_id: campaignId,
        p_limit: BATCH_SIZE,
      });
      if (claimErr) return json({ error: claimErr.message }, 400);

      const rows = (claimed ?? []) as ClaimedRow[];
      if (!rows.length) break;

      const messages = rows.map((r) => {
        const merge = {
          full_name: String(r.merge?.full_name ?? r.full_name ?? ""),
          first_name: String(r.merge?.first_name ?? "").trim() || "there",
          code: String(r.merge?.code ?? ""),
        };
        const unsubscribeUrl = `${functionsUrl}/mail-unsubscribe?t=${r.unsub_token}`;
        const { html, text } = renderCampaign({ ...shape, appUrl, merge, unsubscribeUrl });
        return {
          from: FROM,
          to: [r.email],
          subject: campaign.subject as string,
          html,
          text,
          // RFC 8058. Gmail and Outlook surface their own Unsubscribe control
          // from these, which keeps opt-outs coming to us as requests rather
          // than to the mailbox provider as spam complaints.
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        };
      });

      const res = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });
      const payload = await res.json().catch(() => ({} as Record<string, unknown>));

      if (!res.ok) {
        // The whole batch failed (bad key, rate limit, provider outage). Mark
        // every claimed row failed; those under the attempt limit go back to
        // 'queued' inside mail_mark_recipient and Resume retries them.
        const detail = JSON.stringify(payload).slice(0, 300);
        for (const r of rows) {
          await rpc("mail_mark_recipient", {
            p_id: r.id, p_status: "failed", p_message_id: undefined, p_error: `batch ${res.status}: ${detail}`,
          });
        }
        failed += rows.length;
        console.error("resend batch failed:", res.status, detail);
        break;
      }

      // Resend returns { data: [{ id }, ...] } in request order.
      const ids = Array.isArray((payload as { data?: unknown }).data)
        ? ((payload as { data: { id?: string }[] }).data)
        : [];

      for (let i = 0; i < rows.length; i++) {
        const id = ids[i]?.id ?? null;
        await rpc("mail_mark_recipient", {
          p_id: rows[i].id,
          p_status: id ? "sent" : "failed",
          p_message_id: id ?? undefined,
          p_error: id ? "" : "no message id returned",
        });
        if (id) sent++; else failed++;
      }

      // Resend's default rate limit is 2 requests/second. One batch of 100 is
      // one request, so a short pause between batches keeps us well under it.
      if (rows.length === BATCH_SIZE) await new Promise((r) => setTimeout(r, 600));
    }

    const { data: finished, error: finishErr } = await rpc("mail_finish_send", { p_campaign_id: campaignId });
    if (finishErr) return json({ error: finishErr.message }, 400);

    const summary = (finished ?? {}) as { remaining?: number; sent?: number; failed?: number };
    return json({
      ok: true,
      mode: "live",
      recipientCount: (begun as { recipient_count?: number } | null)?.recipient_count ?? 0,
      sentThisPass: sent,
      failedThisPass: failed,
      totalSent: summary.sent ?? 0,
      totalFailed: summary.failed ?? 0,
      remaining: summary.remaining ?? 0,
    });
  } catch (err) {
    console.error("mail-campaign-send failed:", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});
