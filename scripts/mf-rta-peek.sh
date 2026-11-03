#!/usr/bin/env bash
# Show the layout of a registrar mailback file (CAMS WBR*, KFintech feeds)
# without showing any client data.
#
#   bash scripts/mf-rta-peek.sh ~/Downloads/<attachment>.zip
#
# bsdtar asks for the ZIP password with hidden input. The file is unpacked into
# a private temp folder that is deleted on exit; only column names, types,
# widths and the row count are printed — never a record.
set -euo pipefail

zip="${1:?Usage: bash scripts/mf-rta-peek.sh <file.zip>}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
chmod 700 "$tmp"

bsdtar -xf "$zip" -C "$tmp"

find "$tmp" -type f | while read -r f; do
  python3 -I - "$f" <<'EOF'
import struct, sys, os
path = sys.argv[1]
name = os.path.basename(path)
data = open(path, "rb").read()
if not name.lower().endswith(".dbf"):
    print(f"{name}: {len(data)} bytes (not a DBF; first line hidden)")
    sys.exit()
rows, header_len, rec_len = struct.unpack("<IHH", data[4:12])
print(f"{name}: {rows} rows, record {rec_len} bytes")
print(f"  {'column':<14}{'type':<6}{'width':>5}  dec")
off = 32
while off + 32 <= header_len and data[off] != 0x0D:
    fname = data[off:off + 11].split(b"\0")[0].decode("ascii", "replace")
    ftype = chr(data[off + 11])
    width, dec = data[off + 16], data[off + 17]
    print(f"  {fname:<14}{ftype:<6}{width:>5}  {dec}")
    off += 32
EOF
done
