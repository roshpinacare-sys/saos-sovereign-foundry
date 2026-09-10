#!/bin/sh
# keepalive.sh — roast 61: the sandbox reaps background processes
# unpredictably (measured live 2026-09-10: even a bare `sleep 600` died
# between checks, and all four mini-services were found dead — external-signer,
# fleet-cure, vault-guardian had been up minutes earlier; chief-of-staff's
# original instance died at 01:44 the same silent way). Each service therefore
# runs under this restart loop: any death (crash, reaper, port race) self-heals
# within 5s. Usage: keepalive.sh <service-dir>  (run via setsid nohup, detached)
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
