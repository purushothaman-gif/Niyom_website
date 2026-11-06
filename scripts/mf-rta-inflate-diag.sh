#!/usr/bin/env bash
# Hidden-prompt wrapper for mf-rta-inflate-diag.mjs (prints sizes only).
#   bash scripts/mf-rta-inflate-diag.sh <file.zip>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
read -rsp "Mailback ZIP password: " PW; echo
printf '%s' "$PW" | node "$here/mf-rta-inflate-diag.mjs" "${1:?zip}"
unset PW
