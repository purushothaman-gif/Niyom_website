// ===========================================================================
// delete-crm-user — remove a CRM employee (used when someone resigns)
// ---------------------------------------------------------------------------
// Two modes:
//   { mode: "impact",  employee_id }  → workload counts, no writes
//   { mode: "delete",  employee_id, confirm_code, reassign_to?, reason? }
//
// Deleting revokes the login (auth user) and drops the nw_employees row.
// Almost every FK into nw_employees is ON DELETE SET NULL, so transactions,
// deals, debit notes and logs survive — but anything the employee still *owns*
// (clients, leads, DSAs, open tickets) must be handed to another employee
// first, otherwise it would silently fall into the unassigned pool. The
// function refuses to delete while that book is non-empty unless a
// `reassign_to` employee is supplied.
//
// Super-admin only. A snapshot goes to nw_employee_offboarding_log.
// ===========================================================================
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: caller } = await admin
      .from("nw_employees")
      .select("id, full_name, role, status")
      .eq("auth_user_id", callerUser.id)
      .maybeSingle();

    // Deleting an employee is destructive and irreversible — super admin only.
    if (!caller || caller.role !== "super_admin" || caller.status !== "active") {
      return json({ error: "Forbidden: super admin access required" }, 403);
    }

    const body = await req.json();
    const mode: string = body?.mode === "delete" ? "delete" : "impact";
    const employeeId: string = body?.employee_id;
    if (!employeeId) return json({ error: "employee_id is required" }, 400);

    const { data: target } = await admin
      .from("nw_employees")
      .select("id, auth_user_id, employee_code, full_name, email, role, designation, status, joining_date, avatar_url")
      .eq("id", employeeId)
      .maybeSingle();
    if (!target) return json({ error: "Employee not found." }, 404);
    if (target.id === caller.id) return json({ error: "You cannot delete your own account." }, 400);

    // Never leave the CRM without an active super admin.
    if (target.role === "super_admin") {
      const { count: saCount } = await admin
        .from("nw_employees")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin")
        .eq("status", "active");
      if ((saCount ?? 0) <= 1) {
        return json({ error: "This is the last active super admin — assign another one before deleting." }, 400);
      }
    }

    // ---- workload counts -------------------------------------------------
    const countOf = async (table: string, apply: (q: any) => any) => {
      const { count } = await apply(admin.from(table).select("id", { count: "exact", head: true }));
      return count ?? 0;
    };

    const [clients, leads, dsas, ticketsOpen, transactions, deals, debitNotes, mktContent, referralLinks] =
      await Promise.all([
        countOf("nw_clients", q => q.eq("employee_id", employeeId)),
        countOf("nw_leads", q => q.eq("owner_employee_id", employeeId)),
        countOf("nw_dsa", q => q.eq("employee_id", employeeId)),
        countOf("nw_support_tickets", q => q.eq("assigned_employee_id", employeeId).neq("status", "closed")),
        countOf("nw_transactions", q => q.eq("employee_id", employeeId)),
        countOf("nw_deal_confirmations", q => q.eq("employee_id", employeeId)),
        countOf("dsa_debit_notes", q => q.eq("created_by", employeeId)),
        countOf("mkt_content", q => q.eq("created_by", employeeId)),
        countOf("mkt_referral_links", q => q.eq("employee_id", employeeId)),
      ]);

    const impact = { clients, leads, dsas, tickets_open: ticketsOpen, transactions, deals, debit_notes: debitNotes, marketing_content: mktContent, referral_links: referralLinks };
    // Owned records that would be orphaned by a plain delete.
    const needsReassign = clients + leads + dsas + ticketsOpen;

    if (mode === "impact") {
      return json({
        employee: {
          id: target.id, employee_code: target.employee_code, full_name: target.full_name,
          email: target.email, role: target.role, status: target.status,
        },
        impact,
        needs_reassignment: needsReassign > 0,
      });
    }

    // ---- delete ----------------------------------------------------------
    const confirmCode: string = (body?.confirm_code || "").trim().toUpperCase();
    if (confirmCode !== target.employee_code.toUpperCase()) {
      return json({ error: `Type ${target.employee_code} to confirm deletion.` }, 400);
    }

    const reassignTo: string | null = body?.reassign_to || null;
    const reason: string = (body?.reason || "").trim();

    let successor: { id: string; full_name: string } | null = null;
    if (reassignTo) {
      if (reassignTo === employeeId) return json({ error: "Cannot reassign the book to the employee being deleted." }, 400);
      const { data: succ } = await admin
        .from("nw_employees")
        .select("id, full_name, status")
        .eq("id", reassignTo)
        .maybeSingle();
      if (!succ || succ.status !== "active") return json({ error: "Successor not found or inactive." }, 400);
      successor = { id: succ.id, full_name: succ.full_name };
    }

    if (needsReassign > 0 && !successor) {
      return json({
        error: "This employee still owns records. Pick an employee to take them over first.",
        impact,
        needs_reassignment: true,
      }, 409);
    }

    if (successor) {
      const stamp = new Date().toISOString();

      // Clients — the owning RM moves over; log each move on the client's timeline.
      const { data: movedClients, error: cliErr } = await admin
        .from("nw_clients")
        .update({ employee_id: successor.id, updated_at: stamp })
        .eq("employee_id", employeeId)
        .select("id, full_name, client_code");
      if (cliErr) throw cliErr;

      if (movedClients?.length) {
        await admin.from("nw_activity_logs").insert(
          movedClients.map((c: any) => ({
            employee_id: caller.id,
            client_id: c.id,
            action: "client_reassigned",
            description: `Client reassigned: ${target.full_name} (${target.employee_code}, offboarded) → ${successor!.full_name}` +
              (reason ? ` — ${reason}` : ""),
          })),
        );
      }

      // Leads — including archived/converted ones, so nothing is left ownerless.
      const { data: movedLeads, error: leadErr } = await admin
        .from("nw_leads")
        .update({ owner_employee_id: successor.id, updated_at: stamp })
        .eq("owner_employee_id", employeeId)
        .select("id, status");
      if (leadErr) throw leadErr;

      // A lead that just changed hands should read as Assigned, not New.
      const newLeadIds = (movedLeads ?? []).filter((l: any) => l.status === "New").map((l: any) => l.id);
      if (newLeadIds.length) {
        await admin.from("nw_leads").update({ status: "Assigned" }).in("id", newLeadIds);
      }

      const { error: dsaErr } = await admin
        .from("nw_dsa")
        .update({ employee_id: successor.id, updated_at: stamp })
        .eq("employee_id", employeeId);
      if (dsaErr) throw dsaErr;

      const { error: tkErr } = await admin
        .from("nw_support_tickets")
        .update({ assigned_employee_id: successor.id })
        .eq("assigned_employee_id", employeeId)
        .neq("status", "closed");
      if (tkErr) throw tkErr;

      await admin.from("nw_alerts").insert([{
        employee_id: successor.id,
        title: "Book transferred to you",
        message: `${target.full_name} (${target.employee_code}) was offboarded. You now own ${clients} client(s), ${leads} lead(s)` +
          (dsas ? `, ${dsas} DSA(s)` : "") + (ticketsOpen ? `, ${ticketsOpen} open ticket(s)` : "") + ".",
        category: "client_assigned",
        action_url: "/crm/clients",
      }]);
    }

    // Permanent record of who this was — the SET NULL FKs erase the identity.
    await admin.from("nw_employee_offboarding_log").insert([{
      employee_code: target.employee_code,
      full_name: target.full_name,
      email: target.email,
      role: target.role,
      designation: target.designation,
      joining_date: target.joining_date,
      deleted_by_employee_id: caller.id,
      deleted_by_name: caller.full_name,
      reassigned_to_employee_id: successor?.id ?? null,
      reassigned_to_name: successor?.full_name ?? null,
      reason: reason || null,
      impact,
    }]);

    // Revoke the login first — even if the row delete below fails, the
    // resigned employee can no longer sign in.
    if (target.auth_user_id) {
      const { error: authErr } = await admin.auth.admin.deleteUser(target.auth_user_id);
      // A missing auth user is fine (already removed); anything else is fatal.
      if (authErr && !/not.?found/i.test(authErr.message)) throw authErr;
    }

    if (target.avatar_url) {
      await admin.storage.from("employee-avatars").remove([`avatars/${target.id}.jpg`]);
    }

    const { error: delErr } = await admin.from("nw_employees").delete().eq("id", employeeId);
    if (delErr) {
      return json({ error: `Login revoked, but the employee record could not be deleted: ${delErr.message}` }, 500);
    }

    return json({
      success: true,
      employee_code: target.employee_code,
      full_name: target.full_name,
      reassigned_to: successor?.full_name ?? null,
      impact,
    });
  } catch (err: any) {
    return json({ error: err?.message || "Internal error" }, 500);
  }
});
