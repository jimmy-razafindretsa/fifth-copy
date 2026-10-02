#!/usr/bin/env bash
# Exits non-zero unless DATABASE_URL (or the URL given as $1) points at a local or designated test host.
# Run before any DB command (AGENTS.md, Prisma hazards). Never prints the URL itself.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
url="${1:-${DATABASE_URL:-}}"
if [[ -z "$url" ]]; then
  echo "db-guard: DATABASE_URL is not set" >&2
  exit 2
fi

# postgresql://user:pass@host:port/db?params -> host
rest="${url#*://}"
rest="${rest#*@}"
host="${rest%%[:/?]*}"
if [[ "$rest" == \[* ]]; then host="${rest%%]*}]"; fi

allowed=("localhost" "127.0.0.1" "[::1]" "::1")
extra=(); IFS="," read -r -a extra <<< "${DB_GUARD_ALLOWED_HOSTS:-}"
allowed+=("${extra[@]+"${extra[@]}"}")

for a in "${allowed[@]}"; do
  if [[ -n "$a" && "$host" == "$a" ]]; then
    echo "db-guard: ok (host=$host)"
    exit 0
  fi
done
echo "db-guard: REFUSED. Host '$host' is not local or an allowed test host." >&2
exit 1
