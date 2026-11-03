#!/usr/bin/env bash
# Registrar mailback feed — set or rotate the ZIP password(s) used by the
# mf-rta-import edge function to open the CAMS / KFintech mailback files.
#
# Run it yourself, in your own terminal:  bash scripts/mf-rta-set-password.sh
#
# The password is read with hidden input (nothing is echoed, written to disk or
# kept in shell history) and stored only as a Supabase secret. It is never
# pasted into chat and never committed. The CAMS password is required; the
# KFintech one is optional (leave blank until that feed is wired up).
set -euo pipefail

PROJECT_REF="jlmwazuwjnhoqqloyeoj"

read -rsp "CAMS mailback ZIP password: " CAMS_PW; echo
if [[ -z "$CAMS_PW" ]]; then echo "CAMS password is required." >&2; exit 1; fi
echo "Captured ${#CAMS_PW} characters for CAMS (check this looks right — a doubled paste shows up here)."

read -rsp "KFintech mailback ZIP password (blank to skip): " KF_PW; echo
[[ -n "$KF_PW" ]] && echo "Captured ${#KF_PW} characters for KFintech."

read -rp "Store these as Supabase secrets for mf-rta-import? [y/N] " ok
if [[ "$ok" != "y" && "$ok" != "Y" ]]; then echo "Nothing stored."; exit 0; fi

if [[ -n "$KF_PW" ]]; then
  supabase secrets set --project-ref "$PROJECT_REF" \
    RTA_CAMS_PASSWORD="$CAMS_PW" \
    RTA_KFINTECH_PASSWORD="$KF_PW"
else
  supabase secrets set --project-ref "$PROJECT_REF" \
    RTA_CAMS_PASSWORD="$CAMS_PW"
fi

unset CAMS_PW KF_PW
echo "Done: mf-rta-import can now open the mailback ZIPs."
