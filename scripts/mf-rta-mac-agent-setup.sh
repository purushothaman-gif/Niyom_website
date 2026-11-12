#!/usr/bin/env bash
# One-time setup for the KFintech mailback agent on a Mac (a RESIDENTIAL network
# the KFintech WAF allows). Installs a launchd job that runs the agent every 2
# hours: it pulls the links the Gmail sync queued, downloads each ZIP here, and
# posts the bytes to mf-rta-ingest. Re-run any time to change the secret/URL.
#
#   bash scripts/mf-rta-mac-agent-setup.sh
#
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT="$DIR/mf-rta-mac-agent.mjs"
[ -f "$AGENT" ] || { echo "Can't find $AGENT"; exit 1; }

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node 18+ is required but 'node' is not on PATH."; exit 1; }
echo "Using node: $NODE ($("$NODE" -v))"

DEFAULT_URL="https://jlmwazuwjnhoqqloyeoj.supabase.co"
read -r -p "SUPABASE_URL [$DEFAULT_URL]: " SB; SB="${SB:-$DEFAULT_URL}"
read -r -s -p "RTA_INGEST_SECRET (same one Apps Script uses): " SECRET; echo
[ -n "$SECRET" ] || { echo "The ingest secret is required."; exit 1; }
read -r -p "SUPABASE_ANON_KEY (optional, Enter to skip): " ANON

LABEL="com.niyom.mfrta-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/niyom-mfrta-agent.log"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$AGENT</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>SUPABASE_URL</key><string>$SB</string>
    <key>RTA_INGEST_SECRET</key><string>$SECRET</string>
    <key>SUPABASE_ANON_KEY</key><string>$ANON</string>
  </dict>
  <key>StartInterval</key><integer>7200</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
chmod 600 "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo
echo "Installed '$LABEL' — runs now and every 2 hours while your Mac is awake."
echo "Log:      $LOG"
echo "Run now:  launchctl start $LABEL   (then: tail -f \"$LOG\")"
echo "Stop:     launchctl unload \"$PLIST\""
