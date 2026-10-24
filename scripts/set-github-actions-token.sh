#!/bin/zsh
#
# Store the GitHub fine-grained token that lets pg_cron dispatch the render
# workflow (see migration 20261024100000_mkt_auto_dispatch_render.sql).
#
# The token is read from a hidden prompt and written straight into Supabase
# Vault through a temp file that is shredded afterwards. It never appears in
# your shell history, in a process list, in this repository, or on screen.
#
# Create the token first:
#   GitHub → Settings → Developer settings → Personal access tokens
#          → Fine-grained tokens → Generate new token
#   Repository access : Only select repositories → Niyom_website
#   Permissions       : Repository permissions → Actions → Read and write
#                       (Metadata → Read is added automatically and is required)
#   Expiration        : your call — note that the dispatch silently stops when
#                       it lapses. `select * from mkt_auto_dispatch_status();`
#                       shows 401 when that happens.
#
# Usage:  ./scripts/set-github-actions-token.sh
set -euo pipefail

cd "$(dirname "$0")/.."

printf 'Paste the GitHub fine-grained token (input hidden), then press Enter:\n'
read -rs TOKEN
printf '\n'

if [[ -z "${TOKEN}" ]]; then
  echo "No token entered — nothing changed." >&2
  exit 1
fi

if [[ "${TOKEN}" != github_pat_* && "${TOKEN}" != ghp_* ]]; then
  echo "That does not look like a GitHub token (expected a github_pat_ or ghp_ prefix)." >&2
  echo "Nothing was stored." >&2
  exit 1
fi

# Double any single quotes so the value cannot break out of the SQL literal.
ESCAPED="${TOKEN//\'/\'\'}"

umask 077
TMP="$(mktemp /tmp/ghtoken.XXXXXX.sql)"
trap 'shred -u "$TMP" 2>/dev/null || rm -f "$TMP"' EXIT

cat > "$TMP" <<SQL
DO \$\$
BEGIN
  -- Replace rather than accumulate: a second secret of the same name would be
  -- ambiguous to the dispatch function, which selects by name.
  PERFORM vault.update_secret(id, '${ESCAPED}', 'github_actions_token',
            'Fine-grained GitHub token (Actions: write on Niyom_website) used by trigger_mkt_render_dispatch.')
  FROM vault.secrets WHERE name = 'github_actions_token';

  IF NOT FOUND THEN
    PERFORM vault.create_secret('${ESCAPED}', 'github_actions_token',
              'Fine-grained GitHub token (Actions: write on Niyom_website) used by trigger_mkt_render_dispatch.');
  END IF;
END \$\$;
SQL

supabase db query --linked --file "$TMP" > /dev/null

unset TOKEN ESCAPED

echo "Stored. Verifying length only (never the value):"
cat > "$TMP" <<'SQL'
SELECT name, length(decrypted_secret) AS token_length
FROM vault.decrypted_secrets WHERE name = 'github_actions_token';
SQL
supabase db query --linked --file "$TMP"

echo
echo "Now fire a dispatch to prove it end to end:"
echo "  supabase db query --linked --query \"select trigger_mkt_render_dispatch();\""
echo "  supabase db query --linked --query \"select * from mkt_auto_dispatch_status(3);\"   # 204 = GitHub accepted"
