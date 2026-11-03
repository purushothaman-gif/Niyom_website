#!/usr/bin/env bash
# Show the COLUMN LAYOUT of a KFintech mailback CSV (inside an AES-256 ZIP)
# without showing any client data.
#
#   bash scripts/mf-rta-peek-csv.sh <file.zip>
#
# Reads the ZIP password with hidden input, extracts to a private temp folder
# that is deleted on exit, and prints only the CSV's header row (column names),
# the column count, and how many data rows follow — never a data row.
set -euo pipefail

zip="${1:?Usage: bash scripts/mf-rta-peek-csv.sh <file.zip>}"
read -rsp "KFintech mailback ZIP password: " PW; echo

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; chmod 700 "$tmp"
if ! bsdtar --passphrase "$PW" -xf "$zip" -C "$tmp" 2>/dev/null; then
  echo "Could not open the ZIP — wrong password, or not a supported AES zip." >&2
  unset PW; exit 1
fi
unset PW

csv=$(find "$tmp" -type f -iname '*.csv' | head -1)
[ -z "$csv" ] && { echo "No .csv inside the ZIP. Files: $(find "$tmp" -type f -printf '%f ')"; exit 1; }

echo "member: $(basename "$csv")"
total=$(wc -l < "$csv" | tr -d ' ')
echo "lines: $total (incl. header)"
echo "--- header row (column names only) ---"
head -1 "$csv"
echo "--- column count ---"
head -1 "$csv" | awk -F',' '{print NF" columns"}'
