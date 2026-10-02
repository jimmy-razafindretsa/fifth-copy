---
id: "0002"
title: Prisma 7 with the pg driver adapter, schema folder, server-only client
status: proposed
category: data
scope: ["prisma/**", "prisma.config.ts", "src/server/**", "src/features/*/queries/**", "src/features/*/actions/**"]
supersedes: []
rule: Use the client from src/server/db.ts (or createPrismaClient in scripts/tests); schema in prisma/schema/*.prisma; migrations fix forward only.
---

# 0002. Prisma 7 with the pg driver adapter, schema folder, server-only client

## Context
Prisma 7 moved the datasource URL to `prisma.config.ts`, requires a generator `output`, and uses driver adapters.

## Decision
- `prisma.config.ts` holds schema path (`prisma/schema`), migrations path (`prisma/migrations`), seed command, datasource URL.
- Generator `prisma-client` outputs to `src/generated/prisma` (gitignored, generated on `postinstall`).
- `@prisma/adapter-pg`. `src/server/db-client.ts` is the factory; `src/server/db.ts` is the app singleton (server-only).
- Migrations are created only with `migrate dev` on the local DB after `scripts/db-guard.sh`, and applied elsewhere with `migrate deploy`.

## Consequences
Client code can never import Prisma (boundary rule). Upgrading Prisma majors requires re-reading its config conventions.

## Alternatives considered
Drizzle: lighter, but the kit standardises on Prisma.
