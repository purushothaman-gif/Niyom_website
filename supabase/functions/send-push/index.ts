// Phone notifications for employees — the CRM bell, delivered to the app.
//
// Called ONLY by the nw_alerts_push trigger (pg_net) with the ids of the
// alerts one INSERT just added. verify_jwt is off; the caller proves itself
// with the vault's push_secret, checked inside the database
// (nw_push_secret_ok), so the secret never lives in this function's env.
//
// Sends through Expo's push service, which hands Android messages to FCM.
// A token Expo reports as DeviceNotRegistered (app uninstalled) is deleted.
// Migration: supabase/migrations/20261114140000_push_notifications.sql.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CRM = "https://niyomwealth.com";
const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";

/** Same page mapping as the bell's openAlert (src/crm/Layout.tsx). */
export function crmPathFor(actionUrl: string | null): string {
  const u = actionUrl ?? "";
  if (/^\/crm\/[a-z_]+$/.test(u)) return u;
  if (u.includes("/leads")) return "/crm/leads";
  if (u.includes("/support-tickets")) return "/crm/support_tickets";
  if (u.includes("/bond-orders")) return "/crm/bond_orders";
  if (u.includes("/share-orders")) return "/crm/share_orders";
  if (u.includes("/clients")) return "/crm/clients";
  if (u.includes("/my_hr")) return "/crm/my_hr";
  return "/crm";
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const secret = req.headers.get("x-push-secret") ?? "";
  const { data: ok } = secret ? await db.rpc("nw_push_secret_ok", { p_secret: secret }) : { data: false };
  if (!ok) return new Response("forbidden", { status: 403 });

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.alert_ids) ? body.alert_ids.filter((x: unknown) => typeof x === "string") : [];
  } catch { /* empty */ }
  if (ids.length === 0) return Response.json({ sent: 0 });

  const { data: alerts, error: aErr } = await db
    .from("nw_alerts")
    .select("id, employee_id, title, message, action_url, read")
    .in("id", ids.slice(0, 1000));
  if (aErr) return Response.json({ error: aErr.message }, { status: 500 });

  const empIds = [...new Set((alerts ?? []).map((a) => a.employee_id).filter(Boolean))] as string[];
  if (empIds.length === 0) return Response.json({ sent: 0 });
  const { data: tokens, error: tErr } = await db
    .from("nw_push_tokens")
    .select("token, employee_id")
    .in("employee_id", empIds);
  if (tErr) return Response.json({ error: tErr.message }, { status: 500 });

  const messages: { to: string; title: string; body: string; data: Record<string, string>; sound: string; priority: string; channelId: string }[] = [];
  for (const a of alerts ?? []) {
    if (a.read) continue;
    for (const t of tokens ?? []) {
      if (t.employee_id !== a.employee_id) continue;
      messages.push({
        to: t.token,
        title: a.title || "Niyom Wealth",
        body: a.message || "",
        data: { url: CRM + crmPathFor(a.action_url), alertId: a.id },
        sound: "default",
        priority: "high",
        channelId: "default",
      });
    }
  }

  let sent = 0;
  const dead = new Set<string>();
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    if (expoToken) headers.Authorization = `Bearer ${expoToken}`;
    const res = await fetch(EXPO_PUSH, { method: "POST", headers, body: JSON.stringify(batch) });
    if (!res.ok) {
      console.error("expo push failed", res.status, await res.text());
      continue;
    }
    const out = (await res.json()) as { data?: ExpoTicket[] };
    (out.data ?? []).forEach((ticket, k) => {
      if (ticket.status === "ok") sent++;
      else if (ticket.details?.error === "DeviceNotRegistered") dead.add(batch[k].to);
      else console.error("expo ticket error", ticket.message);
    });
  }
  if (dead.size) await db.from("nw_push_tokens").delete().in("token", [...dead]);

  return Response.json({ sent, removed: dead.size });
});
