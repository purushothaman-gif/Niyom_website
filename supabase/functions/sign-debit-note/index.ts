import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, hashOTP, base64ToBytes } from "../_shared/signing.ts";

// Public function (verify_jwt = false). Re-verifies + consumes the email OTP,
// stores the e-signature PNG and the signed PDF (SEPARATELY from the original
// generated PDF — the original is never overwritten), and permanently locks the
// debit note as signed.
//
// Unlike the Deal Confirmation accept flow, NO email is sent after completion:
// the signed copy is retained inside the CRM only.

const DEBIT_NOTE_BUCKET = "dsa-debit-notes";
const MAX_ATTEMPTS = 5;
function pepper(): string { return Deno.env.get("DEBIT_NOTE_OTP_PEPPER") ?? Deno.env.get("DEAL_OTP_PEPPER") ?? ""; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { token, otp, signatureBase64, signedPdfBase64 } = await req.json().catch(() => ({}));
    if (!token || !otp || !signatureBase64 || !signedPdfBase64) {
      return json({ error: "Missing required fields." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const { data: note } = await db
      .from("dsa_debit_notes")
      .select("id, debit_note_number, month, year, dsa_id, signature_status, status, token_expires_at, dsa:nw_dsa(email)")
      .eq("secure_token", token)
      .maybeSingle();

    if (!note) return json({ error: "This link is no longer valid." }, 400);
    if (note.signature_status === "signed") return json({ error: "This debit note has already been signed." }, 400);
    if (note.status === "cancelled") return json({ error: "This debit note has been cancelled." }, 400);
    if (note.token_expires_at && new Date(note.token_expires_at) < new Date()) {
      return json({ error: "This link has expired." }, 400);
    }

    // --- Verify + consume OTP ---
    const { data: otpRow } = await db
      .from("dsa_debit_note_otps")
      .select("*")
      .eq("debit_note_id", note.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRow) return json({ error: "No verification code found. Please request a new one." }, 400);
    if (new Date(otpRow.expires_at) < new Date()) {
      await db.from("dsa_debit_note_otps").delete().eq("id", otpRow.id);
      return json({ error: "Verification code expired. Please request a new one." }, 400);
    }
    if (otpRow.attempts >= MAX_ATTEMPTS) {
      await db.from("dsa_debit_note_otps").delete().eq("id", otpRow.id);
      return json({ error: "Too many attempts. Please request a new code." }, 429);
    }
    const candidate = await hashOTP(String(otp).trim(), token, pepper());
    if (candidate !== otpRow.otp_hash) {
      await db.from("dsa_debit_note_otps").update({ attempts: otpRow.attempts + 1 }).eq("id", otpRow.id);
      return json({ error: "Incorrect verification code." }, 400);
    }

    // --- Store artifacts ALONGSIDE the original (never overwrite pdf_url) ---
    const mm = String(note.month).padStart(2, "0");
    const base = `${note.year}/${mm}/${note.debit_note_number}`;
    const sigPath = `${base}-signature.png`;
    const signedPdfPath = `${base}-signed.pdf`;

    const sigUp = await db.storage.from(DEBIT_NOTE_BUCKET)
      .upload(sigPath, base64ToBytes(signatureBase64), { contentType: "image/png", upsert: true });
    const pdfUp = await db.storage.from(DEBIT_NOTE_BUCKET)
      .upload(signedPdfPath, base64ToBytes(signedPdfBase64), { contentType: "application/pdf", upsert: true });

    if (sigUp.error || pdfUp.error) {
      console.error("Storage upload error:", sigUp.error || pdfUp.error);
      return json({ error: "Could not store the signed document. Please try again." }, 500);
    }

    const dsaEmail = ((note as any).dsa?.email ?? null) as string | null;

    // --- Lock the note (single UPDATE; OLD.signature_status is still 'viewed') ---
    const { error: updErr } = await db.from("dsa_debit_notes").update({
      signature_status: "signed",
      signed_at: new Date().toISOString(),
      signer_email: dsaEmail,
      signer_ip: req.headers.get("x-forwarded-for") ?? null,
      signer_user_agent: req.headers.get("user-agent") ?? null,
      signature_image_path: sigPath,
      signed_pdf_url: signedPdfPath,
    }).eq("id", note.id);

    if (updErr) {
      console.error("sign update error:", updErr);
      return json({ error: "Could not finalize signing. Please try again." }, 500);
    }

    await db.from("dsa_debit_note_otps").delete().eq("debit_note_id", note.id);
    await db.from("dsa_debit_note_events").insert([
      {
        // metadata: {} is explicit, not omitted: in a multi-row insert PostgREST
        // unifies columns across all rows, so a missing key here is sent as NULL
        // (bypassing the column default) and trips the NOT NULL constraint —
        // failing the whole batch and silently dropping every signing event.
        debit_note_id: note.id, event_type: "otp_verified", actor: "dsa", metadata: {},
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        user_agent: req.headers.get("user-agent") ?? undefined,
      },
      {
        debit_note_id: note.id, event_type: "signed", actor: "dsa",
        metadata: { signer_email: dsaEmail },
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        user_agent: req.headers.get("user-agent") ?? undefined,
      },
      {
        debit_note_id: note.id, event_type: "signed_pdf_stored", actor: "system",
        metadata: { signed_pdf_url: signedPdfPath, signature_image_path: sigPath },
      },
    ]);

    // --- Best-effort: auto-file the signed debit note into the Documents vault of
    // EACH client belonging to this DSA (Sprint 6B — same Approach A as Sprint 6A).
    // The dsa-debit-notes copy above stays the authoritative document; these are
    // convenience copies under each client's "DSA Documents" folder. Deterministic
    // path + idempotency guard prevent duplicates; per-client try/catch and the
    // outer guard ensure this can NEVER block successful signing. The signed PDF
    // bytes are already in memory.
    try {
      const pdfBytes = base64ToBytes(signedPdfBase64);
      const dsaId = (note as any).dsa_id as string | null;
      if (dsaId) {
        const { data: clients } = await db.from("nw_clients")
          .select("id, client_code, employee_id").eq("dsa_id", dsaId);
        for (const client of (clients ?? [])) {
          try {
            if (!client.client_code) continue;
            const fileName = `Signed_DSA_Debit_Note_${note.debit_note_number}.pdf`;
            const vaultPath = `clients/${client.client_code}/DSA_DOCUMENTS/${fileName}`;
            const { data: existingDoc } = await db.from("nw_documents")
              .select("id").eq("file_path", vaultPath).maybeSingle();
            if (existingDoc) continue; // idempotent: already filed for this client
            const up = await db.storage.from("crm-documents")
              .upload(vaultPath, pdfBytes, { contentType: "application/pdf", upsert: true });
            if (up.error) { console.error("DSA doc vault upload error:", up.error); continue; }
            await db.from("nw_documents").insert({
              client_id: client.id,
              employee_id: client.employee_id,
              document_type: "DSA_DOCUMENTS",
              file_name: fileName,
              file_path: vaultPath,
              file_size: pdfBytes.length,
              mime_type: "application/pdf",
              uploaded_by_name: "Auto (DSA debit note signed)",
            });
          } catch (perClientErr: any) {
            console.error("DSA doc auto-file (client) error:", perClientErr?.message);
          }
        }
      }
    } catch (vaultErr: any) {
      console.error("DSA doc auto-file error:", vaultErr?.message);
    }

    return json({ success: true });
  } catch (err: any) {
    console.error("sign-debit-note error:", err?.message);
    return json({ error: "Internal error." }, 500);
  }
});
