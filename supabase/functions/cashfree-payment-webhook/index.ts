import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { asJson } from "../_shared/json.ts";

// Cashfree payment webhook receiver.
// -----------------------------------------------------------------------------
// Closes the loop opened by send-payment-link: that function creates a Cashfree
// Payment Link and logs its link_id into
// nw_deal_email_log.metadata->>'cashfree_link_id'. When the client pays,
// Cashfree POSTs here and we turn that into a row in nw_deal_payments.
//
// PUBLIC endpoint (verify_jwt = false in config.toml) — the caller is Cashfree,
// not a portal user. Authentication is by HMAC signature, not JWT.
//
// Three invariants this function is built around:
//
//   1. NEVER LOSE A MONEY EVENT. Every signature-valid delivery is written to
//      nw_payment_webhook_events BEFORE it is interpreted. If correlation or the
//      insert fails, the row survives with processing_status='unmatched'/'error'
//      for manual reconciliation.
//
//   2. IDEMPOTENT. Cashfree retries on any non-2xx, and may deliver the same
//      event more than once regardless. cf_payment_id lands in
//      provider_payment_id, guarded by the partial unique index
//      uq_nw_deal_payments_provider_txn (provider, provider_payment_id) — so a
//      replay hits a 23505 rather than double-crediting a deal. The pre-check
//      below is only for a clean code path; the index is the real guard, because
//      it is the only one safe under concurrent deliveries.
//
//   3. 200 MEANS "STOP RETRYING", NOT "SUCCEEDED". We return 200 for anything a
//      retry cannot fix (unknown link, rejected deal, malformed body) so
//      Cashfree stops, and rely on the event log to surface it. We return 5xx
//      only for genuinely transient failures, where a retry is the right cure.
//      An invalid signature gets 401 — a forged caller SHOULD keep failing.
//
// Audit events (payment_recorded, outstanding_updated, payment_completed) are
// emitted by the AFTER INSERT trigger on nw_deal_payments, so a payment entering
// through this path is audited identically to one typed in by an RM.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Max age of x-webhook-timestamp before we treat a delivery as a replay. */
const DEFAULT_TOLERANCE_SECONDS = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Comparison whose duration does not depend on where the strings differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Cashfree signs `timestamp + rawBody` with the account's client secret and
 * sends base64(HMAC-SHA256(...)) in x-webhook-signature.
 *
 * rawBody must be the bytes exactly as received — re-serialising a parsed
 * object (key order, whitespace, number formatting) changes the digest and
 * every signature check fails.
 */
async function computeSignature(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(timestamp + rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

type AnyRecord = Record<string, any>;

/**
 * The link_id we generated in send-payment-link, as it comes back on the
 * payment event. Cashfree's payload shape varies by API version and by whether
 * the payment came through a Payment Link or a raw order, so we probe the known
 * carriers rather than betting on one. Unknown shapes fall through to the
 * confirmation-number fallback in resolveDeal().
 */
function extractLinkId(payload: AnyRecord): string | null {
  const d = (payload?.data ?? {}) as AnyRecord;
  const candidates = [
    d?.order?.order_tags?.link_id,
    d?.link?.link_id,
    d?.payment_link?.link_id,
    d?.order_tags?.link_id,
    payload?.link_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Business (IST) calendar date for a Cashfree timestamp. */
function toPaymentDate(paymentTime: unknown): string {
  // payment_time arrives as an ISO string with an IST offset
  // ("2026-08-07T12:30:00+05:30"). Taking the leading date characters keeps the
  // IST calendar date; parsing to a Date and calling toISOString() would
  // normalise to UTC and shift a late-evening payment back a day.
  if (typeof paymentTime === "string") {
    const m = paymentTime.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  // Cashfree probes the URL when you save it in the dashboard.
  if (req.method === "GET" || req.method === "HEAD") {
    return json({ status: "ok", endpoint: "cashfree-payment-webhook" });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const sourceIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    null;

  // --- Read the body as raw text FIRST (signature is over these exact bytes) --
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json({ error: "Unreadable body" }, 400);
  }

  // --- Authenticate -----------------------------------------------------------
  // The webhook is signed with the PG account's client secret. CASHFREE_WEBHOOK_SECRET
  // exists as an override for accounts configured with a distinct webhook secret.
  const secret =
    Deno.env.get("CASHFREE_WEBHOOK_SECRET")?.trim() ||
    Deno.env.get("CASHFREE_SECRET_KEY")?.trim();

  if (!secret) {
    // Refuse rather than accept unauthenticated money events. 503 so Cashfree
    // retries — this is a misconfiguration a deploy can fix, not a bad request.
    console.error("[cashfree-webhook] no signing secret configured");
    return json({ error: "Webhook not configured" }, 503);
  }

  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");
  if (!signature || !timestamp) {
    console.warn(`[cashfree-webhook] missing signature headers ip=${sourceIp ?? "-"}`);
    return json({ error: "Missing signature headers" }, 401);
  }

  const expected = await computeSignature(secret, timestamp, rawBody);
  if (!timingSafeEqual(signature, expected)) {
    console.warn(`[cashfree-webhook] signature mismatch ip=${sourceIp ?? "-"}`);
    return json({ error: "Invalid signature" }, 401);
  }

  // Replay window. The signature covers the timestamp, so an attacker cannot
  // freshen a captured delivery without the secret — this bounds how long a
  // captured-and-resent body stays acceptable.
  const toleranceSeconds = Number(Deno.env.get("CASHFREE_WEBHOOK_TOLERANCE_SECONDS") ?? "") ||
    DEFAULT_TOLERANCE_SECONDS;
  const tsSeconds = Number(timestamp);
  if (Number.isFinite(tsSeconds)) {
    const ageSeconds = Math.abs(Date.now() / 1000 - tsSeconds);
    if (ageSeconds > toleranceSeconds) {
      console.warn(`[cashfree-webhook] stale timestamp age=${Math.round(ageSeconds)}s ip=${sourceIp ?? "-"}`);
      return json({ error: "Stale webhook timestamp" }, 401);
    }
  }

  // Deliberately NOT logged to the DB above this line: the endpoint is public,
  // so persisting unauthenticated bodies would let anyone grow the table.
  // Rejections are visible in the function logs instead.

  // --- Parse ------------------------------------------------------------------
  let payload: AnyRecord;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[cashfree-webhook] signed body was not valid JSON");
    return json({ error: "Malformed payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);

  const data = (payload?.data ?? {}) as AnyRecord;
  const order = (data?.order ?? {}) as AnyRecord;
  const payment = (data?.payment ?? {}) as AnyRecord;
  const customer = (data?.customer_details ?? {}) as AnyRecord;

  const eventType = String(payload?.type ?? "").trim() || null;
  const cfPaymentId = payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null;
  const paymentStatus = String(payment?.payment_status ?? "").trim().toUpperCase() || null;
  const orderId = order?.order_id != null ? String(order.order_id) : null;
  const linkId = extractLinkId(payload);
  const rawAmount = Number(payment?.payment_amount ?? order?.order_amount);
  const amount = Number.isFinite(rawAmount) ? Math.round(rawAmount * 100) / 100 : null;

  // --- 1. Log the raw event before interpreting it ----------------------------
  const { data: eventRow, error: eventErr } = await db
    .from("nw_payment_webhook_events")
    .insert({
      provider: "cashfree",
      event_type: eventType,
      event_at: payload?.event_time != null ? String(payload.event_time) : null,
      link_id: linkId,
      order_id: orderId,
      cf_payment_id: cfPaymentId,
      payment_status: paymentStatus,
      amount,
      signature_verified: true,
      source_ip: sourceIp,
      payload: asJson(payload),
    })
    .select("id")
    .single();

  if (eventErr) {
    // The safety net itself is down. Fail loudly with a 5xx so Cashfree retries
    // — better a duplicate delivery later than a silently dropped payment.
    console.error("[cashfree-webhook] event log insert failed:", eventErr);
    return json({ error: "Could not record webhook" }, 500);
  }
  const eventId = eventRow.id;

  /** Close out the event row. Never throws — it must not mask the HTTP reply. */
  const finish = async (
    status: "recorded" | "duplicate" | "ignored" | "unmatched" | "error",
    note: string,
    extra: { deal_confirmation_id?: string; payment_id?: string } = {},
  ) => {
    try {
      await db
        .from("nw_payment_webhook_events")
        .update({ processing_status: status, processing_note: note.slice(0, 500), ...extra })
        .eq("id", eventId);
    } catch (e) {
      console.error("[cashfree-webhook] event status update failed:", e);
    }
  };

  console.log(
    `[cashfree-webhook] ${eventType ?? "?"} status=${paymentStatus ?? "-"} ` +
      `link=${linkId ?? "-"} cf_payment=${cfPaymentId ?? "-"} amount=${amount ?? "-"} event=${eventId}`,
  );

  try {
    // --- 2. Only successful payments create a ledger row ----------------------
    const isSuccess =
      eventType === "PAYMENT_SUCCESS_WEBHOOK" || (eventType === null && paymentStatus === "SUCCESS");
    if (!isSuccess) {
      await finish("ignored", `Non-success event (${eventType ?? "unknown"}/${paymentStatus ?? "-"}).`);
      return json({ status: "ok", handled: false, event_id: eventId });
    }

    if (!cfPaymentId) {
      await finish("error", "Success event carried no cf_payment_id; cannot dedupe or record.");
      return json({ status: "ok", handled: false, event_id: eventId });
    }
    if (amount === null || amount <= 0) {
      await finish("error", `Success event carried an unusable amount (${payment?.payment_amount}).`);
      return json({ status: "ok", handled: false, event_id: eventId });
    }

    // --- 3. Idempotency pre-check --------------------------------------------
    // Fast, friendly path for the common replay. Races are still caught by
    // uq_nw_deal_payments_provider_txn when the insert runs.
    const { data: existing } = await db
      .from("nw_deal_payments")
      .select("id, payment_number, deal_confirmation_id")
      .eq("provider", "cashfree")
      .eq("provider_payment_id", cfPaymentId)
      .maybeSingle();

    if (existing) {
      await finish("duplicate", `Already recorded as ${existing.payment_number}.`, {
        deal_confirmation_id: existing.deal_confirmation_id,
        payment_id: existing.id,
      });
      return json({ status: "ok", handled: true, duplicate: true, event_id: eventId });
    }

    // --- 4. Correlate the payment back to a deal ------------------------------
    let dealId: string | null = null;
    let matchedBy = "";

    if (linkId) {
      // Primary: the link_id send-payment-link recorded on the email audit row.
      const { data: logRow } = await db
        .from("nw_deal_email_log")
        .select("deal_confirmation_id")
        .eq("email_type", "payment_link")
        .eq("metadata->>cashfree_link_id", linkId)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (logRow) {
        dealId = logRow.deal_confirmation_id;
        matchedBy = `email log (link_id=${linkId})`;
      }
    }

    if (!dealId && linkId) {
      // Fallback: send-payment-link builds link_id as
      // `${confirmation_number}-${base36 time}`, so dropping the last segment
      // recovers the confirmation number even if the email-log write was lost
      // (that insert is best-effort inside a try/catch).
      const guess = linkId.replace(/-[^-]+$/, "");
      if (guess && guess !== linkId) {
        const { data: deal } = await db
          .from("nw_deal_confirmations")
          .select("id")
          .eq("confirmation_number", guess)
          .maybeSingle();
        if (deal) {
          dealId = deal.id;
          matchedBy = `confirmation number parsed from link_id (${guess})`;
        }
      }
    }

    if (!dealId) {
      // Money arrived that we cannot attribute. A retry will not change this, so
      // stop the retries and leave the row for a human.
      console.error(
        `[cashfree-webhook] UNMATCHED payment cf_payment=${cfPaymentId} link=${linkId ?? "-"} amount=${amount}`,
      );
      await finish(
        "unmatched",
        `Could not map to a deal (link_id=${linkId ?? "none"}, order_id=${orderId ?? "none"}). Needs manual reconciliation.`,
      );
      return json({ status: "ok", handled: false, unmatched: true, event_id: eventId });
    }

    // --- 5. Record the payment ------------------------------------------------
    // payment_mode is 'online_gateway' for every gateway capture; the finer
    // instrument (upi / credit_card / net_banking) stays in provider_payload
    // rather than being flattened into payment_mode, which would blur the
    // manual-vs-gateway distinction that `provider` carries.
    const bankReference =
      payment?.bank_reference != null && String(payment.bank_reference).trim()
        ? String(payment.bank_reference).trim()
        : null;
    const paymentGroup = payment?.payment_group ? String(payment.payment_group) : "online";

    const rpcPayload = {
      deal_confirmation_id: dealId,
      amount,
      currency: String(payment?.payment_currency ?? order?.order_currency ?? "INR").toUpperCase(),
      direction: "inflow",
      payment_mode: "online_gateway",
      utr_number: bankReference,
      payment_date: toPaymentDate(payment?.payment_time),
      received_by: null,
      received_from_name: String(customer?.customer_name ?? "").trim(),
      provider: "cashfree",
      provider_payment_id: cfPaymentId,
      provider_order_id: orderId,
      provider_signature: signature,
      provider_payload: payload,
      provider_status: paymentStatus,
      remarks: `Cashfree ${paymentGroup} payment${linkId ? ` via link ${linkId}` : ""}.`,
      // created_by / received_by stay null: the audit trigger reads that as
      // actor='system', which is the truth — no employee recorded this.
    };

    const { data: inserted, error: rpcErr } = await db.rpc("nw_insert_payment", { p_data: rpcPayload });

    if (rpcErr) {
      const code = (rpcErr as AnyRecord)?.code ?? "";
      const message = (rpcErr as AnyRecord)?.message ?? "";
      const details = (rpcErr as AnyRecord)?.details ?? "";
      const blob = `${message} ${details}`;

      // Lost the race with a concurrent delivery of the same payment — the
      // unique index did its job. Not an error.
      if (code === "23505" && blob.includes("uq_nw_deal_payments_provider_txn")) {
        await finish("duplicate", "Concurrent delivery already recorded this payment.", {
          deal_confirmation_id: dealId,
        });
        return json({ status: "ok", handled: true, duplicate: true, event_id: eventId });
      }

      // A real payment we could not book (rejected deal, duplicate bank
      // reference, failed CHECK). Retrying will not fix any of these.
      console.error(`[cashfree-webhook] insert failed cf_payment=${cfPaymentId}:`, rpcErr);
      await finish("error", `nw_insert_payment failed (${code}): ${message}`, {
        deal_confirmation_id: dealId,
      });
      return json({ status: "ok", handled: false, event_id: eventId });
    }

    const row = inserted as AnyRecord;
    console.log(
      `[cashfree-webhook] recorded ${row?.payment_number} on deal ${dealId} (matched by ${matchedBy})`,
    );
    await finish("recorded", `Recorded as ${row?.payment_number} — matched by ${matchedBy}.`, {
      deal_confirmation_id: dealId,
      payment_id: row?.id,
    });

    return json({
      status: "ok",
      handled: true,
      event_id: eventId,
      payment_number: row?.payment_number ?? null,
    });
  } catch (err: any) {
    // Unexpected failure. The event row survives with the full payload, so the
    // payment is recoverable by hand either way.
    console.error("[cashfree-webhook] unexpected error:", err?.message);
    await finish("error", `Unexpected error: ${err?.message ?? "unknown"}`);
    return json({ status: "ok", handled: false, event_id: eventId });
  }
});
