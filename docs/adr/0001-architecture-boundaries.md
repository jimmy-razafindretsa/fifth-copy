---
id: "0001"
title: Feature-sliced src/ layout with enforced import boundaries
status: accepted
category: architecture
scope: ["src/**"]
supersedes: []
rule: app -> features -> server/lib; cross-feature imports only via index.ts; components/ui imports no features/server; enforced by .dependency-cruiser.cjs.
---

# 0001. Feature-sliced src/ layout with enforced import boundaries

## Context
Agents work one card at a time with fresh context. Without hard boundaries, each card drifts the structure a little. The kit's AGENTS.md defines an architecture map; it must be machine-checked to hold.

## Decision
- Layout per AGENTS.md "Architecture map" (`src/app`, `src/features/<f>/{components,actions,queries,schema.ts,index.ts}`, `src/components/ui`, `src/server`, `src/lib`, `src/env.ts`).
- Boundaries enforced by dependency-cruiser (`npm run boundaries`, part of `scripts/check.sh`) plus ESLint rules (`process.env` only in `src/env.ts`; no server/Prisma imports in `src/components`).

## Consequences
Violations fail `scripts/check.sh` and CI. Adding a new top-level folder under `src/` needs an ADR update.

## Alternatives considered
eslint-plugin-boundaries: works, but dependency-cruiser also catches cycles and transitive paths with one config.
