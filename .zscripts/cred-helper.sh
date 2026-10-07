#!/usr/bin/env bash
# cred-helper.sh — git credential helper backed by upload/pat.env (PAT never written to .git/config)
# Recreated after sandbox reset (R234). Protocol: git calls with "get" on stdin.
set -euo pipefail
PAT_FILE="/home/z/my-project/upload/pat.env"

case "${1:-}" in
  get)
    if [[ -f "$PAT_FILE" ]]; then
      # shellcheck disable=SC1090
      PAT_VALUE="$(grep -hoE '(ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)' "$PAT_FILE" | head -1 || true)"
      if [[ -n "${PAT_VALUE:-}" ]]; then
        printf 'username=roshpinacare-sys\n'
        printf 'password=%s\n' "$PAT_VALUE"
        exit 0
      fi
    fi
    exit 1
    ;;
  store|erase)
    # no-op: PAT lives only in upload/pat.env
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
