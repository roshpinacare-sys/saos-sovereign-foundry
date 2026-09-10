#!/bin/sh
# keepalive.sh — MANUAL OPS TOOL ONLY (roast 62/63 revision).
#
# History: roast 61 introduced this as the supervision mechanism, but roast 62
# proved it was itself a background process the sandbox reaped with its parent
# shell — a second fiction. The CANONICAL reviver is src/instrumentation-node.ts
# (supervisor inside the Next process, TCP probes, request-driven healNow via
# supervisor-bridge) — services run as children of the platform-held Next
# process and are verified live via GET /api/saos/status → "supervisor" truth.
#
# This script remains only for a human operator manually babysitting a service
# during a session. It does NOT honor SAOS_NO_* .env flags (roast-62 principle:
# disk config truth) — if you disabled a service via .env, do NOT keepalive it.
#
# Usage: keepalive.sh <service-dir>  (run via setsid nohup, detached)
SERVICE_DIR="$1"
[ -d "$SERVICE_DIR" ] || { echo "usage: keepalive.sh <service-dir>" >&2; exit 1; }
LOG="$SERVICE_DIR/keepalive.log"
cd "$SERVICE_DIR" || exit 1
echo "$(date -Is) [keepalive] supervising $SERVICE_DIR" >> "$LOG"
while true; do
  bun run dev >> "$LOG" 2>&1
  echo "$(date -Is) [keepalive] service exited code=$? — restarting in 5s" >> "$LOG"
  sleep 5
done
