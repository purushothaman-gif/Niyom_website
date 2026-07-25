import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// NIYOM-001 employee ID — all public walk-in clients are mapped here
const DEFAULT_EMPLOYEE_ID = "1b543112-3251-4912-847b-92982f2de563";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const {
      full_name, pan, dob, phone, email,
      address, city, state, pincode,
      demat_account, dp_name,
      bank_account, bank_ifsc, bank_name,
      notes,
    } = body;

    // Basic required field checks
    if (!full_name || !pan || !dob || !phone || !email || !address || !city || !state || !pincode) {
      return new Response(JSON.stringify({ error: "Missing required fields." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for duplicate PAN
    const { data: existing } = await supabase
      .from("nw_clients")
      .select("id")
      .eq("pan", pan.toUpperCase())
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "A client with this PAN already exists in our system. Please contact support." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate client code under NIYOM-001
    const { data: clientCode, error: codeErr } = await supabase.rpc("nw2_generate_client_code", {
      p_employee_id: DEFAULT_EMPLOYEE_ID,
    });
    if (codeErr) throw codeErr;

    const { data: client, error: clientErr } = await supabase.from("nw_clients").insert([{
      client_code: clientCode,
      employee_id: DEFAULT_EMPLOYEE_ID,
      full_name: full_name.trim(),
      pan: pan.toUpperCase(),
      dob,
      phone,
      email: email.trim().toLowerCase(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      demat_account: demat_account?.trim() || null,
      dp_name: dp_name?.trim() || null,
      bank_account: bank_account?.trim() || null,
      bank_ifsc: bank_ifsc?.toUpperCase()?.trim() || null,
      bank_name: bank_name?.trim() || null,
      notes: notes?.trim() || null,
      verification_status: "pending",
      sourced_via: "direct",
      client_login_enabled: false,
      // Superseded flow, but keep it lifecycle-consistent if any stale link hits it.
      onboarding_status: "kyc_under_review",
    }]).select().single();

    if (clientErr) throw clientErr;

    // Sprint 5: seed the client's PRIMARY bank account (mirror already on nw_clients).
    const acctNo = bank_account?.trim();
    const acctIfsc = bank_ifsc?.toUpperCase()?.trim();
    const acctBank = bank_name?.trim();
    if (acctNo || acctIfsc || acctBank) {
      await supabase.from("nw_client_bank_accounts").insert([{
        client_id: client.id,
        account_number: acctNo || "",
        ifsc: acctIfsc || "",
        bank_name: acctBank || "",
        is_primary: true,
      }]);
    }

    // Log the activity
    await supabase.from("nw_activity_logs").insert([{
      employee_id: DEFAULT_EMPLOYEE_ID,
      client_id: client.id,
      action: "Client Onboarded (Public)",
      description: `${full_name} self-onboarded via public portal with code ${clientCode}. Pending admin approval.`,
    }]);

    return new Response(JSON.stringify({ success: true, client_code: clientCode, client_name: full_name.trim() }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "An unexpected error occurred." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
