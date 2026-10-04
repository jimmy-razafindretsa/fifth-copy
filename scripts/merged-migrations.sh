#!/usr/bin/env bash
# Fails when the working tree modifies, deletes or renames a migration that exists on <base-ref>
# (AGENTS.md Prisma hazards: never edit a merged migration, fix forward). Adding migrations is fine.
# CI runs it on the PR merge commit:  scripts/merged-migrations.sh origin/main
set -euo pipefail
base="${1:-}"
[[ -n "$base" ]] || { echo "usage: scripts/merged-migrations.sh <base-ref>" >&2; exit 2; }
changed="$(git diff --name-only --diff-filter=MDR "$base" -- prisma/migrations)"
if [[ -n "$changed" ]]; then
  echo "Edited/deleted merged migrations (fix forward with a new migration instead):"
  echo "$changed"
  exit 1
fi
echo "merged migrations unchanged"
