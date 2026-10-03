---
id: "0012"
title: One VPS, Docker Compose, Caddy TLS, images built in CI, deploy on merge with race-server draining
status: accepted
category: tooling
scope: ["deploy/**", "Dockerfile.web", "Dockerfile.race", ".github/workflows/**", "scripts/deploy-smoke.sh"]
supersedes: []
rule: Production is docker compose on one VPS behind Caddy (automatic Let's Encrypt TLS; /socket.io/* and /internal/* proxied to race-server, everything else to web); CI builds versioned images for web and race-server, runs prisma migrate deploy, replaces web immediately and race-server only when it reports zero live rooms (or after a hard timeout), then runs deploy-smoke.
---

# 0012. One VPS, Docker Compose, Caddy TLS, images built in CI, deploy on merge with race-server draining

## Context
HTTPS on our own domain (R207), GitHub flow with protected main and tags (R208, R209), CI on every change and automatic deploy on merge (R210, R211). Merging during a class must not kill a live race (critic gap in `work/plan/fifth-copy-board.json`, card #412). The team is students; operations must stay small. The hosting provider is still an open question for the teacher (Q4). Cards #402-#413.

## Decision
- **Topology (one VPS, Ubuntu LTS, Docker):** `caddy` (ports 80/443) -> `web` (Next.js standalone, port 3000) and `race-server` (port 4000); `postgres:17` and `redis:7` on the private compose network with volumes; `worker` (web image, `worker` command). Files under `deploy/`: `docker-compose.prod.yml`, `Caddyfile`, `deploy.sh`, `.env.production.example` (names only).
- **Routing:** Caddy proxies `/socket.io/*` and `/internal/*` to `race-server` (WebSocket upgrade is automatic), everything else to `web`. Security headers and a strict CSP come from `web` (`next.config.ts`), not Caddy.
- **Images:** CI builds `ghcr.io/<owner>/fifth-copy-web:<sha>` (multi-stage, `output: "standalone"`) and `fifth-copy-race:<sha>` (esbuild bundle), tags `latest` on main and `vX.Y.Z` on release tags.
- **Deploy job (on push to main, after the required checks):** ssh to the VPS, `docker compose pull`, `prisma migrate deploy` from the web image (migrations are expand-only, ADR 0002), `up -d web worker` (web restarts in seconds; stale browsers reload on protocol or build id mismatch), then **race-server deploy-when-idle**: poll `GET /health` until `rooms == 0` (up to 60 min), send `SIGTERM` (drain), `up -d race-server`; after the hard timeout, deploy anyway and the voided rooms show the "cable lost" state (ADR 0008). Finish with `scripts/deploy-smoke.sh https://<domain>` which checks `/api/health`, `/` and the race server's `/health` through Caddy.
- **Secrets:** GitHub Environments hold the SSH key and the image registry token; runtime secrets live only in `/srv/fifth-copy/.env.production` on the VPS (never in the repo, never printed), rotated by a human.
- **Backups:** nightly `pg_dump` to an off-box bucket with 14-day retention and a quarterly restore drill (card #407); backups are purged on the same schedule as deleted user data (Law 25, card #85).
- **Observability:** both processes log JSON (`pino`) with PII redaction to Docker logs; `/api/health` and `/health` are the uptime probes (card #423); error reporting is a later ADR (card #419).

## Consequences
- One machine is a single point of failure; acceptable for one school, and the compose file ports to any Docker host if the teacher picks a different provider.
- Deploys of the race server can wait for a class to end; the CD log says why.
- Version skew between web and race server is caught by `PROTOCOL_VERSION` in the handshake.

## Alternatives considered
- **Vercel for web + separate VPS for sockets:** easy web deploys, but two hosts, two secrets stores, cross-origin cookies and the spec's "our own site" requirement. Rejected.
- **Kubernetes:** blue/green for free, far too much surface for a student team. Rejected.
- **nginx + certbot:** works, but Caddy does ACME and WebSocket proxying with a 10-line file. Rejected.
- **Blue/green race server (two containers, Caddy upstream switch):** zero-wait deploys; more moving parts than deploy-when-idle. Upgrade path if waiting becomes a problem.
