---
id: "0003"
title: Separate local test database, migrated with migrate deploy
status: proposed
category: data
scope: ["e2e/**", "src/**/*.test.ts", "scripts/test-db.sh", "prisma/docker-init/**", ".github/workflows/**"]
supersedes: []
rule: Tests that touch the DB use TEST_DATABASE_URL (database app_test), prepared by scripts/test-db.sh; never the dev DB, never a remote DB.
---

# 0003. Separate local test database, migrated with migrate deploy

## Context
Tests must not clobber development data, and agents must never reset a shared database.

## Decision
- Local: database `app_test` on the docker compose server (created by `prisma/docker-init/01-test-db.sql`).
- `scripts/test-db.sh` runs `db-guard` on `TEST_DATABASE_URL`, then `prisma migrate deploy` against it.
- CI: a throwaway Postgres service container; same script.
- Tests clean up their own rows (or truncate tables in a setup hook). No `migrate reset`.

## Consequences
Two DBs locally. Pure unit tests should not need a DB at all.

## Alternatives considered
Testcontainers per run: slower locally; revisit if parallel test isolation becomes a problem.
