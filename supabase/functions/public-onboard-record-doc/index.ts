import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, serviceClient, NIYOM_DEFAULT_EMPLOYEE_ID } from "../_shared/onboarding.ts";

// Step 3 — record a KYC document row in nw_documents after the client has
// uploaded the file to the crm-documents storage bucket. Runs with the service
// role (avoiding the old flow's hard-coded employee UUID + RLS fragility), but
// requires the client's session and ownership of the client record.

const ALLOWED_TYPES = new Set(["PAN", "CML", "BANK"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user || user.user_metadata?.is_client !== true) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const client_id = (body.client_id || "").trim();
    const document_type = (body.document_type || "").trim().toUpperCase();
    const file_name = (body.file_name || "").trim();
    const file_path = (body.file_path || "").trim();
    const file_size = Number(body.file_size) || 0;
    const mime_type = (body.mime_type || "").trim();

    if (!client_id || !ALLOWED_TYPES.has(document_type) || !file_name || !file_path) {
      return json({ error: "Missing or invalid document details." }, 400);
    }

    const db = serviceClient();
    const { data: client } = await db
      .from("nw_clients")
      .select("id, full_name, client_auth_user_id")
      .eq("id", client_id)
      .maybeSingle();
    if (!client || client.client_auth_user_id !== user.id) return json({ error: "Unauthorized" }, 403);

    const { error: docErr } = await db.from("nw_documents").insert([{
      client_id,
      employee_id: NIYOM_DEFAULT_EMPLOYEE_ID,
      document_type,
      file_name,
      file_path,
      file_size,
      mime_type,
      uploaded_by_name: client.full_name,
    }]);
    if (docErr) throw docErr;

    // Mirror KYC document state onto nw_clients so the client portal (which
    // cannot read nw_documents) can drive its onboarding checklist.
    const flag: Record<string, string> = { PAN: "pan_doc_uploaded", BANK: "bank_verified", CML: "cml_uploaded" };
    await db.from("nw_clients").update({ [flag[document_type]]: true }).eq("id", client_id);

    return json({ success: true }, 200);
  } catch (err: any) {
    console.error("public-onboard-record-doc error:", err?.message);
    return json({ error: err?.message || "Could not save the document. Please try again." }, 500);
  }
});
