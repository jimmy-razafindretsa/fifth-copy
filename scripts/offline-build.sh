#!/usr/bin/env bash
# #574 C2: a production build with the font hosts unreachable. Every proxy variable points at a dead
# port (127.0.0.1:9), so any request next/font or Turbopack makes to fonts.googleapis.com or
# fonts.gstatic.com fails; the build must still exit 0 because the fonts are committed (src/app/fonts.ts).
# NODE_OPTIONS DNS overrides would not work: Turbopack fetches Google fonts from Rust, which honours the
# proxy variables. Writes to .next like `npm run build`.
#   scripts/offline-build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DEAD="http://127.0.0.1:9"
LOG="$(mktemp -t offline-build)"
echo "offline-build: npm run build with every proxy at $DEAD (font hosts unreachable)"
if env HTTPS_PROXY="$DEAD" https_proxy="$DEAD" HTTP_PROXY="$DEAD" http_proxy="$DEAD" \
  ALL_PROXY="$DEAD" all_proxy="$DEAD" NO_PROXY="" no_proxy="" NEXT_TELEMETRY_DISABLED=1 \
  npm run build >"$LOG" 2>&1; then
  echo "offline-build: ok"
  rm -f "$LOG"
else
  status=$?
  echo "offline-build: FAILED (exit $status); font/error lines of $LOG:"
  grep -iE "font|error" "$LOG" | head -8
  exit "$status"
fi
