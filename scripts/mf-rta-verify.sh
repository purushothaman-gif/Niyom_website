#!/usr/bin/env bash
# Diagnose a failing mailback import: is the password wrong, or is our
# decryption code wrong? Reads the password once with hidden input and checks
# it two independent ways against the given ZIP:
#   1. bsdtar (libarchive) — the reference decryptor.
#   2. our own winzip.ts / dbf.ts / wbr9.ts, exactly as the edge function runs.
# Prints only OK/FAIL and non-identifying counts — never any client record.
#
#   bash scripts/mf-rta-verify.sh <file.zip> [more.zip ...]   (password asked once)
set -euo pipefail

[ $# -ge 1 ] || { echo "Usage: bash scripts/mf-rta-verify.sh <file.zip>..."; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"

read -rsp "Mailback ZIP password: " PW; echo

for zip in "$@"; do
  echo "=== $(basename "$zip")"
  tmp=$(mktemp -d); chmod 700 "$tmp"
  if bsdtar --passphrase "$PW" -xf "$zip" -C "$tmp" 2>/dev/null; then
    echo "bsdtar:  OK   (password opens the file)"
  else
    echo "bsdtar:  FAIL (password did not open the file)"
  fi
  rm -rf "$tmp"
  echo "our code:"
  printf '%s' "$PW" | node "$here/mf-rta-verify.mjs" "$zip" || true
done
unset PW
