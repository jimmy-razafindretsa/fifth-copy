#!/usr/bin/env bash
# Regenerates visual baselines inside the SAME pinned Playwright image CI uses, from the committed tree (HEAD).
# Baseline changes need the PR label `visual-change` and a note in the PR body. Never run this to make a diff pass.
# Mirrors the CI `visual` job (.github/workflows/ci.yml): same CI-only, non-secret env literals, Postgres + Redis,
# `npm run build` and `npm run build:race` (Playwright starts the race server). The local .env is never forwarded.
#   scripts/visual-baselines.sh            update baselines (writes e2e/__screenshots__)
#   scripts/visual-baselines.sh --check    run visual tests only, no update
# Portable: GNU/Linux and macOS mktemp. Behind an HTTPS proxy (HTTPS_PROXY set) the proxy vars are forwarded
# by name, the CA bundle in VISUAL_CA_BUNDLE or NODE_EXTRA_CA_CERTS is mounted read-only, and a loopback proxy
# makes the container use host networking (Postgres and Redis on their published localhost ports).
set -euo pipefail
cd "$(dirname "$0")/.."
PW_VERSION="$(node -p "require('@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
MODE="--update-snapshots"; [[ "${1:-}" == "--check" ]] && MODE=""
docker compose up -d --wait postgres redis >/dev/null
PROXY="${HTTPS_PROXY:-${https_proxy:-}}"
CA="${VISUAL_CA_BUNDLE:-${NODE_EXTRA_CA_CERTS:-}}"
if [[ -n "$PROXY" && "$PROXY" =~ ://([^@/]*@)?(localhost|127\.[0-9.]+|\[::1\])(:|/|$) ]]; then
  # Host networking shares the host's ports: take the worktree's PW_PORT / RACE_SERVER_PORT when loaded.
  NETWORK=host; DB_HOST=localhost; WEB_PORT="${PW_PORT:-3100}"; RACE_PORT="${RACE_SERVER_PORT:-4000}"
else
  NETWORK="$(docker inspect "$(docker compose ps -q postgres)" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
  DB_HOST=postgres; WEB_PORT=3100; RACE_PORT=4000
fi
REDIS_HOST="$([[ "$DB_HOST" == localhost ]] && echo localhost || echo redis)"
NET_ARGS=(--network "$NETWORK")
if [[ -n "$PROXY" ]]; then
  export HTTPS_PROXY="$PROXY" https_proxy="$PROXY" npm_config_https_proxy="$PROXY"
  export NO_PROXY="localhost,127.0.0.1${NO_PROXY:+,$NO_PROXY}"; export no_proxy="$NO_PROXY"
  NET_ARGS+=(-e HTTPS_PROXY -e https_proxy -e npm_config_https_proxy -e NO_PROXY -e no_proxy)
  if [[ -n "$CA" && -f "$CA" ]]; then NET_ARGS+=(-v "$CA:/visual-ca.crt:ro" -e NODE_EXTRA_CA_CERTS=/visual-ca.crt); fi
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/visual-src.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/src.tar"
git archive --format=tar HEAD -o "$ARCHIVE"
mkdir -p e2e/__screenshots__
echo "visual: $IMAGE on network $NETWORK (${MODE:-check only}${PROXY:+, via proxy})"
docker run --rm "${NET_ARGS[@]}" \
  -e CI=1 -e PW_VISUAL=1 -e NEXT_TELEMETRY_DISABLED=1 \
  -e DATABASE_URL="postgresql://app:app@$DB_HOST:5432/app?schema=public" \
  -e RACE_TOKEN_SECRET=ci-only-race-token-secret-0123456789abcdef0123456789abcdef \
  -e AUTH_SECRET=ci-only-auth-secret-0123456789abcdef0123456789abcdef \
  -e REDIS_URL=redis://$REDIS_HOST:6379/0 -e RACE_SERVER_PORT=$RACE_PORT -e PW_PORT=$WEB_PORT -e WEB_ORIGIN=http://localhost:$WEB_PORT \
  -e NEXT_PUBLIC_RACE_SERVER_URL=http://localhost:$RACE_PORT -e RACE_SERVER_INTERNAL_URL=http://localhost:$RACE_PORT \
  -v "$ARCHIVE:/src.tar:ro" -v "$PWD/e2e/__screenshots__:/out" \
  "$IMAGE" bash -c "
    set -e; mkdir /app && cd /app && tar -xf /src.tar
    cp -r /out/. e2e/__screenshots__/ 2>/dev/null || true
    npm ci --no-audit --no-fund >/dev/null
    npm run build >/dev/null
    npm run build:race >/dev/null
    npx playwright test --grep @visual $MODE --reporter=line
    cp -r e2e/__screenshots__/. /out/"
echo "visual: done. Review e2e/__screenshots__ before committing."
