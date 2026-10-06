#!/usr/bin/env bash
# Prepares the test database (docs/adr/0003): guard, then apply migrations with migrate deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/dotenv-get.sh
. scripts/lib/dotenv-get.sh
if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  TEST_DATABASE_URL="$(dotenv_get TEST_DATABASE_URL)"
fi
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is not set (see .env.example)}"
scripts/db-guard.sh "$TEST_DATABASE_URL"
if [[ -d prisma/migrations ]] && compgen -G "prisma/migrations/*/migration.sql" >/dev/null; then
  DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy 2>&1 | tail -3
else
  echo "test-db: no migrations yet, nothing to apply"
fi
