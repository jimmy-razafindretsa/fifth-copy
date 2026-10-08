#!/usr/bin/env bash
# Regenerates visual baselines inside the SAME pinned Playwright image CI uses, from the committed tree (HEAD).
# Baseline changes need the PR label `visual-change` and a note in the PR body. Never run this to make a diff pass.
# Mirrors the CI `visual` job (.github/workflows/ci.yml): same CI-only, non-secret env literals, Postgres + Redis,
# `npm run build` and `npm run build:race` (Playwright starts the race server). The local .env is never forwarded.
#   scripts/visual-baselines.sh            update baselines (writes e2e/__screenshots__)
#   scripts/visual-baselines.sh --check    run visual tests only, no update
set -euo pipefail
cd "$(dirname "$0")/.."
PW_VERSION="$(node -p "require('@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
MODE="--update-snapshots"; [[ "${1:-}" == "--check" ]] && MODE=""
docker compose up -d --wait postgres redis >/dev/null
NETWORK="$(docker inspect "$(docker compose ps -q postgres)" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
ARCHIVE="$(mktemp -t visual-src).tar"
git archive --format=tar HEAD -o "$ARCHIVE"
mkdir -p e2e/__screenshots__
echo "visual: $IMAGE on network $NETWORK (${MODE:-check only})"
docker run --rm --network "$NETWORK" \
  -e CI=1 -e PW_VISUAL=1 -e NEXT_TELEMETRY_DISABLED=1 \
  -e DATABASE_URL="postgresql://app:app@postgres:5432/app?schema=public" \
  -e RACE_TOKEN_SECRET=ci-only-race-token-secret-0123456789abcdef0123456789abcdef \
  -e AUTH_SECRET=ci-only-auth-secret-0123456789abcdef0123456789abcdef \
  -e REDIS_URL=redis://redis:6379/0 -e RACE_SERVER_PORT=4000 -e WEB_ORIGIN=http://localhost:3100 \
  -e NEXT_PUBLIC_RACE_SERVER_URL=http://localhost:4000 -e RACE_SERVER_INTERNAL_URL=http://localhost:4000 \
  -v "$ARCHIVE:/src.tar:ro" -v "$PWD/e2e/__screenshots__:/out" \
  "$IMAGE" bash -c "
    set -e; mkdir /app && cd /app && tar -xf /src.tar
    cp -r /out/. e2e/__screenshots__/ 2>/dev/null || true
    npm ci --no-audit --no-fund >/dev/null
    npm run build >/dev/null
    npm run build:race >/dev/null
    npx playwright test --grep @visual $MODE --reporter=line
    cp -r e2e/__screenshots__/. /out/"
rm -f "$ARCHIVE"
echo "visual: done. Review e2e/__screenshots__ before committing."
