#!/usr/bin/env bash
# Minimal post-deploy checks. Usage: scripts/deploy-smoke.sh [base-url]  (default $SMOKE_URL or http://localhost:3000)
# Only point this at localhost or your own preview/staging URL.
set -euo pipefail
BASE="${1:-${SMOKE_URL:-http://localhost:3000}}"
BASE="${BASE%/}"
fail=0

check() { # name, path, expected status, optional body substring
  local name="$1" path="$2" want="$3" needle="${4:-}" body code
  body="$(mktemp)"
  code="$(curl -s -o "$body" -w '%{http_code}' --max-time 15 "$BASE$path" || echo 000)"
  if [[ "$code" != "$want" ]]; then
    echo "FAIL $name: GET $path -> $code (want $want)"; fail=1
  elif [[ -n "$needle" ]] && ! grep -q "$needle" "$body"; then
    echo "FAIL $name: GET $path body missing '$needle'"; fail=1
  else
    echo "PASS $name: GET $path -> $code"
  fi
  rm -f "$body"
}

check health /api/health 200 '"ok":true'
check home / 200
check not-found /__smoke_does_not_exist__ 404

if (( fail )); then echo "smoke: FAILED ($BASE)"; exit 1; fi
echo "smoke: ok ($BASE)"
