---
id: "0021"
title: A feature may expose a server-only public entry, server.ts, beside index.ts
status: accepted
category: architecture
scope: ["src/features/*/index.ts", "src/features/*/server.ts", ".dependency-cruiser.cjs"]
supersedes: []
rule: Cross-feature imports go through the other feature's index.ts (client-safe, no server-only, no Prisma) or its server.ts (starts with import "server-only"; only server code imports it, never a component).
---

# 0021. A feature may expose a server-only public entry, server.ts, beside index.ts

## Context
ADR 0001 makes `index.ts` the only door into a feature. `src/features/texts/index.ts` is imported by client components (`isClean`, `generateRaceText`), so it must stay free of `server-only` and Prisma. #346 adds a database-backed text provider (`loadCorpusProvider`, a Prisma query) that `startRace` in the results feature needs. Exporting it from `index.ts` would pull Prisma into client bundles (or make the whole index server-only); reaching into `texts/queries/` breaks ADR 0001.

## Decision
- A feature may add a second public entry, `src/features/<f>/server.ts`, that starts with `import "server-only"` and re-exports the feature's server-side API (queries, actions meant for other features).
- `index.ts` stays client-safe: no `server-only`, no Prisma, no server entry re-export.
- Dependency-cruiser accepts `server.ts` as a cross-feature and route target (`feature-public-api-only`, `app-feature-public-api-only`) and forbids it from components (`feature-server-entry-not-in-components`) and from any feature's `index.ts` (`feature-index-not-server-entry`); `server-only` makes a client import elsewhere (a `"use client"` file outside `components/`) fail the build.
- This extends ADR 0001 (public entries only, enforced by `.dependency-cruiser.cjs`); it does not supersede it.

## Consequences
Server-side cross-feature APIs have one obvious home and are machine-checked; client bundles never see them. Each feature still has a small, explicit public surface (two files at most).

## Alternatives considered
- Export from `index.ts`: Prisma in the client graph, or `index.ts` turns server-only and breaks client imports.
- Import `texts/queries/corpus-provider` directly: violates ADR 0001 and leaks internal paths.
- Inject the provider from the route (`src/app/api/internal/races`): moves texts wiring into a thin route and every other `startRace` caller.
