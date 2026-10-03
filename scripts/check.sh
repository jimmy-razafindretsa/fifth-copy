#!/usr/bin/env bash
# The cheap gate: format, lint, types (app + workspaces), boundaries, unit tests, ADR index freshness, prisma validate.
# Prints <= 20 lines. Full logs go to .cache/check/<step>.log (gitignored).
#   scripts/check.sh            run all steps
#   scripts/check.sh lint unit  run only named steps
set -uo pipefail
cd "$(dirname "$0")/.."
LOG_DIR=.cache/check
mkdir -p "$LOG_DIR"

NAMES=(format lint types boundaries unit adr prisma)
cmd_for() {
  case "$1" in
    format) echo "npx prettier --check . --log-level warn" ;;
    lint) echo "npx eslint . --max-warnings=0" ;;
    types) echo "npx next typegen && npx tsc --noEmit && npm run -s typecheck:workspaces" ;;
    boundaries) echo "npx depcruise src packages services --config .dependency-cruiser.cjs --output-type err" ;;
    unit) echo "npx vitest run --reporter=dot" ;;
    adr) echo "npx tsx scripts/adr-index.ts --check" ;;
    prisma) echo "npx prisma validate" ;;
    *) echo "" ;;
  esac
}

if [[ $# -gt 0 ]]; then selected=("$@"); else selected=("${NAMES[@]}"); fi

failed=0
lines=0
for name in "${selected[@]}"; do
  cmd="$(cmd_for "$name")"
  if [[ -z "$cmd" ]]; then echo "check: unknown step '$name' (known: ${NAMES[*]})"; exit 2; fi
  start=$(date +%s)
  if bash -c "$cmd" >"$LOG_DIR/$name.log" 2>&1; then
    echo "PASS $name ($(( $(date +%s) - start ))s)"
  else
    failed=$((failed + 1))
    echo "FAIL $name ($(( $(date +%s) - start ))s) log: $LOG_DIR/$name.log"
    # up to 3 informative lines per failing step, total output capped below 20 lines
    if (( lines < 9 )); then
      grep -E -i "error|fail|✖|×|violation|warn|stale|invalid|expected" "$LOG_DIR/$name.log" \
        | grep -v -E "^\s*$" | head -3 | cut -c1-160 | sed 's/^/  /'
      lines=$((lines + 3))
    fi
  fi
done

if (( failed )); then
  echo "check: $failed step(s) failed"
  exit 1
fi
echo "check: all green"
