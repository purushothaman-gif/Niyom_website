// client-profile-update — client self-service for contact details, nominees
// and bank accounts.
//
//   { action: "request_otp" }                       email a 6-digit code to the
//                                                   client's REGISTERED email
//   { action: "apply", otp, change: { kind, ... } } verify the code, apply ONE
//                                                   change, log it, alert the RM
//
// change.kind:
//   "contact"       { phone?, email?, address?, city?, state?, pincode? }
//   "nominees"      { nominees: [...] }  full replacement; shares total 100%
//   "bank_add"      { account_number, ifsc, holder_name?, label?, make_primary? }
//                   saved as 'pending' — usable only after the client's RM
//                   (or an admin) approves it in the CRM (nw_review_client_bank)
//   "bank_delete"   { id }   at least one account must remain
//   "bank_primary"  { id }
//
// Writes use the service role (the client has no write access to these tables;
// the nw_clients self-update guard stays in force). The CRM reads the same
// rows, so changes appear there immediately. The sign-in email is NOT changed
// by an email change here — it stays the auth user's email (see the client
// shared-contact invariant); this updates the contact email on record.
//
// verify_jwt = true: the caller must be a signed-in client.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { decideOtp, generateOtp, hashOtp } from '../_shared/otp.ts';
import {
  maskAccount,
  validateBank,
  validateContact,
  validateNominees,
  type NomineeInput,
} from '../_shared/profile/profileRules.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;
const pepper = () => Deno.env.get('PASSWORD_RESET_OTP_PEPPER') ?? Deno.env.get('ONBOARDING_OTP_PEPPER') ?? '';

interface ClientRow {
  id: string;
  full_name: string;
  client_code: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  pan_name: string | null;
  employee_id: string | null;
}

function maskEmail(e: string | null): string {
  if (!e) return 'your email';
  const [u, d] = e.split('@');
  return d ? `${u.slice(0, 2)}${'*'.repeat(Math.max(u.length - 2, 1))}@${d}` : 'your email';
}

async function sendOtpEmail(to: string, name: string, code: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return false;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;background:#f6f6f6;margin:0;padding:0;">
  <div style="max-width:520px;margin:0 auto;padding:28px 24px;background:#fff;">
    <div style="font-size:20px;font-weight:700;border-bottom:2px solid #D4AF37;padding-bottom:14px;margin-bottom:18px;">Niyom Wealth</div>
    <p>Dear ${name.replace(/[<>&"]/g, '')},</p>
    <p>Use this code to confirm the change to your profile:</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#B8961E;background:#FFF9EC;border:1px solid #D4AF37;border-radius:8px;text-align:center;padding:16px 0;margin:18px 0;">${code}</div>
    <p style="color:#555;font-size:13px;">Valid for 10 minutes. If you did not ask to change your profile, ignore this email and contact your relationship manager.</p>
    <p style="margin-top:18px;font-weight:600;">Niyom Wealth Distribution LLP</p>
  </div></body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Niyom Wealth <support@niyomwealth.com>',
      to: [to],
      subject: 'Confirm your profile change — Niyom Wealth',
      html,
      text: `Your Niyom Wealth profile change code is ${code}. Valid for 10 minutes.`,
    }),
  }).catch(() => null);
  return !!res?.ok;
}

/** Bank name for an IFSC (Razorpay's free public IFSC directory), best-effort. */
async function bankNameForIfsc(ifsc: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const d = (await res.json()) as { BANK?: string; BRANCH?: string };
    return d.BANK ? `${d.BANK}` : null;
  } catch {
    return null;
  }
}

/** Accounts that are in use: not awaiting approval and not rejected. */
const usable = (status: string | null | undefined) => !['pending', 'rejected', 'failed'].includes(String(status ?? ''));

async function logAndAlert(
  db: SupabaseClient,
  client: ClientRow,
  changes: Array<{ field: string; old_value: string | null; new_value: string | null }>,
  alert?: { title: string; message: string },
) {
  if (!changes.length) return;
  await db.from('nw_client_profile_changes').insert(changes.map((c) => ({ ...c, client_id: client.id })));
  await db.from('nw_clients').update({ updated_at: new Date().toISOString() }).eq('id', client.id);
  if (client.employee_id) {
    const fields = [...new Set(changes.map((c) => c.field))].join(', ');
    await db.from('nw_alerts').insert({
      employee_id: client.employee_id,
      title: alert?.title ?? 'Client updated their profile',
      message: alert?.message ?? `${client.full_name} (${client.client_code}) changed: ${fields}. Verified by email OTP.`,
      category: 'client_profile',
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const { data: userData } = await db.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (!uid) return json({ error: 'Please sign in again.' }, 401);

  const { data: client } = await db
    .from('nw_clients')
    .select('id, full_name, client_code, email, phone, address, city, state, pincode, pan_name, employee_id')
    .eq('client_auth_user_id', uid)
    .eq('client_login_enabled', true)
    .maybeSingle<ClientRow>();
  if (!client) return json({ error: 'Client account not found.' }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  // ---------------------------------------------------------------- OTP
  if (body.action === 'request_otp') {
    if (!client.email) return json({ error: 'No email on file — please contact your relationship manager.' }, 400);
    const { data: prev } = await db.from('nw_client_profile_otps').select('created_at').eq('client_id', client.id).maybeSingle();
    if (prev && Date.now() - new Date(prev.created_at).getTime() < RESEND_GAP_MS) {
      return json({ error: 'Please wait a minute before requesting another code.' }, 429);
    }
    const code = generateOtp();
    await db.from('nw_client_profile_otps').upsert({
      client_id: client.id,
      otp_hash: await hashOtp(code, client.id, pepper()),
      attempts: 0,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      created_at: new Date().toISOString(),
    });
    const sent = await sendOtpEmail(client.email, client.full_name, code);
    if (!sent) return json({ error: 'We could not send the code. Please try again.' }, 502);
    return json({ ok: true, email_masked: maskEmail(client.email) });
  }

  if (body.action !== 'apply') return json({ error: 'Unknown action.' }, 400);

  const { data: stored } = await db
    .from('nw_client_profile_otps')
    .select('otp_hash, attempts, expires_at')
    .eq('client_id', client.id)
    .maybeSingle();
  if (!stored) return json({ error: 'Please request a code first.' }, 400);
  const decision = await decideOtp(stored, String(body.otp ?? ''), { key: client.id, pepper: pepper(), nowMs: Date.now() });
  if (decision.outcome === 'wrong') {
    await db.from('nw_client_profile_otps').update({ attempts: decision.attempts }).eq('client_id', client.id);
    return json({ error: decision.error }, 400);
  }
  if (decision.outcome !== 'ok') {
    await db.from('nw_client_profile_otps').delete().eq('client_id', client.id);
    return json({ error: decision.error }, 400);
  }
  // Single use: consumed before applying, so a failure means asking for a new code.
  await db.from('nw_client_profile_otps').delete().eq('client_id', client.id);

  const change = (body.change ?? {}) as Record<string, unknown>;
  const kind = String(change.kind ?? '');

  try {
    // ------------------------------------------------------------ contact
    if (kind === 'contact') {
      const v = validateContact(change as never);
      if (!v.ok) return json({ error: v.error }, 400);
      const patch: Record<string, string> = {};
      const log: Array<{ field: string; old_value: string | null; new_value: string | null }> = [];
      for (const [k, val] of Object.entries(v.value)) {
        const old = (client as unknown as Record<string, string | null>)[k] ?? null;
        if (old === val) continue;
        patch[k] = val as string;
        log.push({ field: k, old_value: old, new_value: val as string });
      }
      if (!log.length) return json({ ok: true, changed: [] });
      // A changed mobile is no longer the one we verified at onboarding.
      const update: Record<string, unknown> = { ...patch };
      if (patch.phone) update.phone_verified = false;
      const { error } = await db.from('nw_clients').update(update).eq('id', client.id);
      if (error) throw error;
      await logAndAlert(db, client, log);
      return json({ ok: true, changed: log.map((l) => l.field) });
    }

    // ----------------------------------------------------------- nominees
    if (kind === 'nominees') {
      const v = validateNominees((change.nominees ?? []) as NomineeInput[]);
      if (!v.ok) return json({ error: v.error }, 400);
      const { data: before } = await db.from('nw_client_nominees').select('full_name, share_percent').eq('client_id', client.id);
      const { error: delErr } = await db.from('nw_client_nominees').delete().eq('client_id', client.id);
      if (delErr) throw delErr;
      if (v.value.length) {
        const { error } = await db
          .from('nw_client_nominees')
          .insert(v.value.map((n) => ({ ...n, client_id: client.id, added_via: 'client_portal' })));
        if (error) throw error;
      }
      const fmt = (l: Array<{ full_name: string; share_percent: number }> | null) =>
        (l ?? []).map((n) => `${n.full_name} (${n.share_percent}%)`).join('; ') || 'none';
      await logAndAlert(db, client, [{ field: 'nominees', old_value: fmt(before), new_value: fmt(v.value) }]);
      return json({ ok: true });
    }

    // ----------------------------------------------------------- bank add
    if (kind === 'bank_add') {
      const v = validateBank(change as never);
      if (!v.ok) return json({ error: v.error }, 400);
      const b = v.value;
      const { data: existing } = await db
        .from('nw_client_bank_accounts')
        .select('id, account_number, ifsc, verification_status')
        .eq('client_id', client.id);
      const live = (existing ?? []).filter((e) => e.verification_status !== 'rejected');
      // Same cap the CRM's bank manager enforces.
      if (live.length >= 5) return json({ error: 'You can keep up to 5 bank accounts. Remove one first.' }, 400);
      if (live.some((e) => e.account_number === b.account_number && e.ifsc === b.ifsc)) {
        return json({ error: 'This bank account is already on your profile.' }, 400);
      }
      const bankName = await bankNameForIfsc(b.ifsc);
      // With no usable account yet, the first approved one becomes primary.
      const requestedPrimary = !!b.make_primary || !(existing ?? []).some((e) => usable(e.verification_status));
      const { data: ins, error } = await db
        .from('nw_client_bank_accounts')
        .insert({
          client_id: client.id,
          account_number: b.account_number,
          ifsc: b.ifsc,
          bank_name: bankName ?? '',
          holder_name: b.holder_name ?? client.full_name,
          label: b.label ?? '',
          is_primary: false,
          requested_primary: requestedPrimary,
          verification_status: 'pending',
          added_via: 'client_portal',
        })
        .select('id')
        .single();
      if (error) throw error;
      const label = `${bankName ?? 'Bank'} ${maskAccount(b.account_number)} ${b.ifsc}`;
      await logAndAlert(
        db,
        client,
        [{ field: 'bank_account_added', old_value: null, new_value: `${label} — awaiting RM approval${requestedPrimary ? ' (as primary)' : ''}` }],
        {
          title: 'Bank account awaiting your approval',
          message: `${client.full_name} (${client.client_code}) added ${label}${requestedPrimary ? ' as primary' : ''}. Approve or reject it in Manage Clients → Bank Accounts.`,
        },
      );
      return json({ ok: true, id: ins?.id, status: 'pending', bank_name: bankName });
    }

    // ---------------------------------------------------- bank delete/primary
    if (kind === 'bank_delete' || kind === 'bank_primary') {
      const id = String(change.id ?? '');
      const { data: all } = await db
        .from('nw_client_bank_accounts')
        .select('id, account_number, ifsc, bank_name, is_primary, verification_status')
        .eq('client_id', client.id)
        .order('created_at');
      const target = (all ?? []).find((a) => a.id === id);
      if (!target) return json({ error: 'Bank account not found.' }, 404);

      if (kind === 'bank_delete') {
        // Pending or rejected accounts can always be withdrawn; an account in
        // use can go only while another approved account remains.
        const others = (all ?? []).filter((a) => a.id !== id && usable(a.verification_status));
        if (usable(target.verification_status) && others.length === 0) {
          return json({ error: 'You need at least one approved bank account on your profile.' }, 400);
        }
        const { error } = await db.from('nw_client_bank_accounts').delete().eq('id', id).eq('client_id', client.id);
        if (error) throw error;
        let promoted: { id: string; account_number: string; ifsc: string; bank_name: string | null } | undefined;
        if (target.is_primary) {
          promoted = others[0];
          if (promoted) {
            await db.from('nw_client_bank_accounts').update({ is_primary: true }).eq('id', promoted.id);
            await db.from('nw_clients').update({ bank_account: promoted.account_number, bank_ifsc: promoted.ifsc, bank_name: promoted.bank_name }).eq('id', client.id);
          }
        }
        await logAndAlert(db, client, [
          { field: 'bank_account_removed', old_value: `${target.bank_name ?? 'Bank'} ${maskAccount(target.account_number)}`, new_value: promoted ? `primary now ${maskAccount(promoted.account_number)}` : null },
        ]);
        return json({ ok: true });
      }

      if (!usable(target.verification_status)) return json({ error: 'This account is still awaiting approval.' }, 400);
      if (target.is_primary) return json({ ok: true });
      await db.from('nw_client_bank_accounts').update({ is_primary: false }).eq('client_id', client.id);
      await db.from('nw_client_bank_accounts').update({ is_primary: true }).eq('id', id);
      await db.from('nw_clients').update({ bank_account: target.account_number, bank_ifsc: target.ifsc, bank_name: target.bank_name }).eq('id', client.id);
      await logAndAlert(db, client, [
        { field: 'primary_bank', old_value: maskAccount((all ?? []).find((a) => a.is_primary)?.account_number), new_value: `${target.bank_name ?? 'Bank'} ${maskAccount(target.account_number)}` },
      ]);
      return json({ ok: true });
    }

    return json({ error: 'Unknown change.' }, 400);
  } catch (e) {
    console.error('[client-profile-update] failed:', (e as Error)?.message);
    return json({ error: 'We could not save that change. Please try again.' }, 500);
  }
});
