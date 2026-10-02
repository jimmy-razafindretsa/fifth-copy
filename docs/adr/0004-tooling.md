---
id: "0004"
title: Tooling baseline (npm, Vitest, Playwright + axe, GitHub Actions)
status: proposed
category: tooling
scope: ["package.json", "package-lock.json", "scripts/**", "vitest.config.ts", "playwright.config.ts", ".github/**"]
supersedes: []
rule: Use npm (npx for binaries), Vitest for unit tests, Playwright + @axe-core/playwright for e2e/eyes; new dependencies need a one-line PR justification.
---

# 0004. Tooling baseline

## Context
The repo was created with npm (package-lock.json). The kit needs a unit runner, an e2e runner with accessibility checks, and CI.

## Decision
npm; Vitest (unit, `src/**/*.test.ts`, `scripts/**/*.test.ts`); Playwright with `@axe-core/playwright` (e2e, `scripts/see.ts`); dependency-cruiser (boundaries); Prettier; GitHub Actions.

## Consequences
Visual baselines are generated inside the pinned Playwright container image so they are stable across machines.

## Alternatives considered
pnpm (kit default): switching package manager is a separate `touches:deps` card if wanted.
