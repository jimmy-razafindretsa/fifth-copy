#!/usr/bin/env bash
# Prepares the test database (docs/adr/0003): guard, then apply migrations with migrate deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${TEST_DATABASE_URL:-}" && -f .env ]]; then
  TEST_DATABASE_URL="$(grep -E '^TEST_DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is not set (see .env.example)}"
scripts/db-guard.sh "$TEST_DATABASE_URL"
if [[ -d prisma/migrations ]] && compgen -G "prisma/migrations/*/migration.sql" >/dev/null; then
  DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy 2>&1 | tail -3
else
  echo "test-db: no migrations yet, nothing to apply"
fi
