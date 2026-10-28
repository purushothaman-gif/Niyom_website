#!/usr/bin/env bash
# MF platform (investor SSO) — set or rotate the production credentials.
#
# Run it yourself, in your own terminal:  bash scripts/mf-sso-prod-setup.sh
#
# 1. Asks for the API key, secret key and IV with hidden input (nothing is
#    echoed, written to disk or kept in shell history).
# 2. Optionally tests them against the live Login API with a PAN you choose.
#    Prints only Status, Message and the sign-in link's host — never the token.
# 3. On your confirmation, stores them as Supabase secrets for mf-sso-login
#    and switches the function off mock mode.
#
# Clients only reach the function once VITE_MF_SSO=true is set on Vercel, so
# this step changes nothing for live users by itself.
set -euo pipefail

PROJECT_REF="jlmwazuwjnhoqqloyeoj"
API_BASE="https://api.wylth.com"

read -rsp "API key: " MF_API_KEY; echo
read -rsp "Secret key: " MF_SECRET_KEY; echo
read -rsp "IV: " MF_IV; echo

key_len=$(printf %s "$MF_SECRET_KEY" | wc -c | tr -d ' ')
iv_len=$(printf %s "$MF_IV" | wc -c | tr -d ' ')
if [[ "$key_len" != 16 && "$key_len" != 24 && "$key_len" != 32 ]]; then
  echo "Secret key must be 16, 24 or 32 characters (got $key_len)." >&2; exit 1
fi
if [[ "$iv_len" != 16 ]]; then
  echo "IV must be 16 characters (got $iv_len)." >&2; exit 1
fi
echo "Lengths OK: API key ${#MF_API_KEY}, secret key $key_len, IV $iv_len."

read -rp "PAN to test with (a client mapped on the MF platform; blank to skip): " TEST_PAN
if [[ -n "$TEST_PAN" ]]; then
  MF_API_KEY="$MF_API_KEY" MF_SECRET_KEY="$MF_SECRET_KEY" MF_IV="$MF_IV" \
  TEST_PAN="$TEST_PAN" API_BASE="$API_BASE" node --input-type=module -e '
    import crypto from "node:crypto";
    const key = Buffer.from(process.env.MF_SECRET_KEY, "utf8");
    const cipher = crypto.createCipheriv(`aes-${key.length * 8}-cbc`, key, Buffer.from(process.env.MF_IV, "utf8"));
    const json = JSON.stringify({ pan: process.env.TEST_PAN.trim().toUpperCase() });
    const data = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]).toString("base64");
    const res = await fetch(`${process.env.API_BASE}/api/investorsso/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MF_API_KEY}` },
      body: JSON.stringify({ data }),
    });
    const body = await res.json().catch(() => null);
    console.log(`HTTP ${res.status} · Status ${body?.Status} · Message: ${body?.Message}`);
    const url = body?.Data?.redirect_url;
    if (url) {
      const u = new URL(url);
      console.log(`Sign-in link host: ${u.host}${u.pathname} (token not shown)`);
    }
  '
fi

read -rp "Store these as Supabase secrets and switch mf-sso-login to live? [y/N] " ok
if [[ "$ok" != "y" && "$ok" != "Y" ]]; then echo "Nothing stored."; exit 0; fi

supabase secrets set --project-ref "$PROJECT_REF" \
  WYLTH_API_BASE="$API_BASE" \
  WYLTH_API_KEY="$MF_API_KEY" \
  WYLTH_SECRET_KEY="$MF_SECRET_KEY" \
  WYLTH_IV="$MF_IV"
supabase secrets unset --project-ref "$PROJECT_REF" WYLTH_GATEWAY || true
unset MF_API_KEY MF_SECRET_KEY MF_IV
echo "Done: mf-sso-login now calls the live MF platform."
