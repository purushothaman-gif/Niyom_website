#!/usr/bin/env bash
# Registrar mailback AUTOMATION — generate (or rotate) the shared secret that
# authenticates the Google Apps Script to the mf-rta-ingest edge function.
#
# Run it yourself, in your own terminal:  bash scripts/mf-rta-set-ingest-secret.sh
#
# It generates a strong random secret, stores it as the RTA_INGEST_SECRET
# Supabase server secret, and copies it to your clipboard so you can paste it
# into the Apps Script "INGEST_SECRET" property. The secret is NEVER printed to
# the screen, written to disk, or pasted into chat. Rotating it (re-running this)
# invalidates the old one — update the Apps Script property afterwards.
set -euo pipefail

PROJECT_REF="jlmwazuwjnhoqqloyeoj"

# 48 url-safe chars from the OS CSPRNG.
SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 48)"
if [[ ${#SECRET} -ne 48 ]]; then echo "Could not generate a secret." >&2; exit 1; fi

read -rp "Generate a new ingest secret and store it on Supabase? [y/N] " ok
if [[ "$ok" != "y" && "$ok" != "Y" ]]; then echo "Nothing changed."; exit 0; fi

supabase secrets set --project-ref "$PROJECT_REF" RTA_INGEST_SECRET="$SECRET" >/dev/null

if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$SECRET" | pbcopy
  echo "Done. The new secret is set on Supabase and copied to your clipboard."
  echo "Paste it into the Apps Script script property INGEST_SECRET (it is not shown here)."
else
  echo "Done. The new secret is set on Supabase."
  echo "pbcopy not found — reveal it once to copy into Apps Script with:"
  echo "    supabase secrets list --project-ref $PROJECT_REF   # names only; value is not retrievable"
  echo "(If you need the value, re-run this on a Mac so it can copy to the clipboard.)"
fi

unset SECRET
