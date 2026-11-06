#!/usr/bin/env bash
# Run a command up to <attempts> times, each attempt killed after <seconds> (card #819).
# A stalled attempt (e.g. apt in `playwright install-deps`) fails fast and is retried, instead of
# eating a CI step's whole timeout once. Exit: 0 on the first success, else the last attempt's code.
#   scripts/retry.sh <attempts> <seconds> <command> [args...]   (RETRY_BACKOFF_SECONDS, default 5)
set -uo pipefail

if [[ $# -lt 3 || ! "$1" =~ ^[1-9][0-9]*$ || ! "$2" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: scripts/retry.sh <attempts> <seconds> <command> [args...]" >&2
  exit 2
fi
attempts=$1 seconds=$2
shift 2

code=1
for ((i = 1; i <= attempts; i++)); do
  timeout --kill-after=10 "$seconds" "$@"
  code=$?
  [[ $code -eq 0 ]] && exit 0
  reason="exit $code"
  [[ $code -eq 124 || $code -eq 137 ]] && reason="stalled past ${seconds}s"
  echo "retry.sh: attempt $i/$attempts failed ($reason): $*" >&2
  ((i < attempts)) && sleep "${RETRY_BACKOFF_SECONDS:-5}"
done
exit "$code"
