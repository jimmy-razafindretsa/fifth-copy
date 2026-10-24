---
id: "0019"
title: Production runs on Railway (web, race-server, Postgres, Redis as Railway services), replacing the single VPS
status: proposed
category: tooling
scope: ["railway.json", "railway.toml", ".github/workflows/**", "scripts/deploy-smoke.sh", "src/env.ts", "services/race-server/src/env.ts"]
supersedes: ["0012"]
rule: Production is the Railway project with four services (web = Next.js from the repo root, race-server = the services/race-server workspace, Railway Postgres, Railway Redis); Railway builds from main on push, web runs prisma migrate deploy as its pre-deploy command, secrets live only in Railway variables (generated, never printed or committed), and every new env var is added to the matching Railway service in the same PR.
---

# 0019. Production runs on Railway, replacing the single VPS

## Context
ADR 0012 chose one VPS with Docker Compose and Caddy, and left the provider open (Q4). On 2026-10-20 the owner chose Railway: the free Oracle Cloud ARM server could not be created (out of capacity in `ca-montreal-1`), and nobody on the team wants to run a server. Railway's first auto-import of the repo created one service per npm workspace (`@fifth-copy/protocol`, `@fifth-copy/engine`, `@fifth-copy/race-server`) with no database, no Redis and no variables, so every build or start failed on `src/env.ts` and `services/race-server/src/env.ts` validation.

## Decision
- **Project:** Railway project `perfect-endurance`, environment `production`, region `sfo`.
- **Services:**
  - `web` (still named `@fifth-copy/protocol` in the dashboard until renamed; private host `web.railway.internal`): repo root, Railpack builder, build `npm run build`, start `npm run start` on `PORT=8080`, pre-deploy `npx prisma migrate deploy` (migrations stay expand-only, ADR 0002), healthcheck `/api/health`. Watch paths: everything except `services/race-server/**`, `docs/**`, `work/**`, `agents/**`, `e2e/**`. A volume `avatars` is mounted at `/data/avatars` (`AVATAR_DIR`, ADR 0014).
  - `race-server` (`@fifth-copy/race-server`; private host `race-server.railway.internal`): build `npm run build --workspace=@fifth-copy/race-server`, start `npm run start --workspace=@fifth-copy/race-server`, port 4000, healthcheck `/health`. Watch paths: `services/race-server/**`, `packages/**`, `package-lock.json`.
  - `Postgres` and `Redis`: Railway's official templates, each with its own volume.
  - `packages/engine` and `packages/protocol` are libraries bundled into the two apps; they are never services.
- **Domains:** each app has a Railway domain (`*.up.railway.app`). The browser opens Socket.IO directly on the race-server domain (`NEXT_PUBLIC_RACE_SERVER_URL`), allowed by `WEB_ORIGIN` CORS; no reverse proxy sits in front. A custom domain replaces both later without code changes.
- **Variables (names only):**
  - web: `DATABASE_URL` (reference to Postgres), `AUTH_SECRET`, `RACE_TOKEN_SECRET`, `RACE_SERVER_INTERNAL_URL` (`http://race-server.railway.internal:4000`), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_RACE_SERVER_URL`, `AVATAR_DIR`, `NODE_ENV`, `PORT`.
  - race-server: `REDIS_URL` (reference to Redis, with `?family=0` so ioredis resolves Railway's private DNS over IPv4 or IPv6), `RACE_TOKEN_SECRET` (same value as web), `WEB_ORIGIN`, `RACE_SERVER_PORT`, `RACE_FAST_CLOCK=0`, `NODE_ENV`.
  - Secrets are generated with `openssl rand -hex 32` and piped into the Railway CLI (`railway variable set --stdin`); they are never printed, committed or pasted into issues. Rotation is a human task.
- **Deploys:** Railway builds and deploys each service on push to `main` when its watch paths change. `NEXT_PUBLIC_*` values are build-time, so changing them needs a web rebuild.

## Consequences
- No server to patch, no Caddy, no Compose file, no SSH key in GitHub; Railway handles TLS and restarts.
- **Lost from ADR 0012:** race-server deploy-when-idle. Railway replaces the race-server container on every matching push, so a merge during a class can void live rooms (they show "cable lost", ADR 0008). Until a follow-up decides otherwise, merges that touch `services/race-server/**` or `packages/**` should land outside class time. Railway's deployment overlap and draining settings, or a manual deploy trigger for race-server, are the candidate fixes.
- CD smoke (`scripts/deploy-smoke.sh`) and the nightly backup (card #407) still need Railway equivalents; Railway volume backups or a scheduled `pg_dump` service are the options.
- Cost: four always-on services plus volumes are usage-billed (roughly 5 to 15 USD a month at school load). This is not free hosting.
- Lock-in is small: both apps still build with plain `npm` and read only env vars, so moving to any Docker host later means writing the Dockerfiles ADR 0012 described.

## Alternatives considered
- **ADR 0012 as written (one VPS, Compose, Caddy):** full control and deploy-when-idle, but someone has to run and patch the server. The owner declined.
- **Oracle Cloud Always Free ARM VM:** free, but A1 capacity in the home region was unavailable, the free allowance was halved to 2 OCPU / 12 GB in 2026, idle instances can be reclaimed, and CI would need arm64 images. Rejected for now.
- **Vercel for web + Railway for race-server:** two providers and two secret stores for no gain over one Railway project. Rejected.
