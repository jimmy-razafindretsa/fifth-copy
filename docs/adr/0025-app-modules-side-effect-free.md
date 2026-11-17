---
id: "0025"
title: App modules are side-effect free unless listed in package.json sideEffects; the first-load budget runs on every route in CI
status: accepted
category: tooling
scope: ["package.json", "src/**/index.ts", "src/**/merge-step.ts", "src/**/merge-steps.ts", "src/features/identity/merge/steps.ts", "src/lib/side-effects.test.ts", "scripts/bundle-budget.ts", ".github/workflows/ci.yml"]
supersedes: []
rule: A src module that must run when imported without a used name (a bare `import "./x";`, a guest-merge step registration) is listed in package.json `sideEffects` (src/lib/side-effects.test.ts checks it); every other app module is side-effect free, and CI fails a build whose route first-load JS is over ADR 0018's budget (`scripts/bundle-budget.ts --all`).
---

# 0025. App modules are side-effect free unless listed in package.json `sideEffects`; the first-load budget runs on every route in CI

## Context
Card #986. On main (55caa9d) every App Router route's first-load JS was over ADR 0018's 300 kB gzip: 340 kB for a static page like `/privacy`, 408 kB for `/design`. Two causes, measured on the client-reference manifests `scripts/bundle-budget.ts` reads:

1. **Barrels pulled in every client component.** Routes import features through their `index.ts` (AGENTS.md import rules). Turbopack follows a re-export straight to its module only when the barrel and what it re-exports are side-effect free. Its local inference counts any top-level call (`z.object(...)`, `createStore()`) as a side effect, so it evaluated whole barrels: the root layout's one `MergeStamp` import from `@/features/identity` put 39 client components of identity, landing, preferences and system into every route's layout chunk, with what they import.
2. **zod and a node:crypto polyfill on the settings screen.** Three settings pickers imported constants from `identity/schema.ts`; that module builds zod schemas and imports the reset-code helpers, which use `node:crypto`. The client got zod (31 kB) and crypto-browserify (~135 kB gzip).

Nothing in CI ran the budget, so the overrun grew unseen (#275 was meant to wire it in).

## Decision
- package.json declares `sideEffects`: stylesheets (`*.css`) and the modules that register a guest-merge step on import (ADR 0009, #56): the feature step files, `src/app/(auth)/merge-steps.ts`, `identity/merge/steps.ts`, and the `lobby` and `results` barrels that import their step file bare. Every other module of the root package is side-effect free, so a route that imports one name from a barrel gets that name's module graph, not the barrel's.
- A bare import of an app module (`import "./x";`, `import "@/features/x";`) means "run this module": its target must be listed. `src/lib/side-effects.test.ts` fails when one is not, or when a file calling `registerMergeStep` at top level is not.
- Client components read plain values from zod-free modules (here `identity/preferences/values.ts`); `schema.ts` keeps the zod schemas and re-exports the values.
- `scripts/bundle-budget.ts --all` measures every App Router route of a build (route groups and Next's `/_not-found`, `/_global-error` included) and exits 1 when any is over `BUDGET_KB`. CI runs it in the e2e job right after `npm run build`, once (shard 1 of the `parallel` suite).

## Consequences
- Every route measured 135 to 200 kB gzip on the card's head (was 340 to 408 kB): about 100 kB of headroom on the heaviest route (`/race/[raceId]`, 199.6 kB).
- A card that adds module-level work run only by a bare import must list the file, or the bundler drops it; the unit test names the file. Registration through a named import (the module's export is used) needs no entry.
- A client component that reaches zod, `node:*` or a whole barrel shows up as a CI failure only once the route crosses 300 kB; the per-route lines in the CI log show the trend before that.
- ADR 0018's figure and ADR 0013's other budgets are unchanged. ARCHITECTURE section 10 says the budget covers every route and runs in CI.

## Alternatives considered
- **Import feature internals directly from routes** (skip the barrels): breaks the `app-feature-public-api-only` boundary rule (ADR 0001 import rules) for every route.
- **Split each barrel into client and server entries**: the same effect for this bug, but one more public file per feature and a rule to keep them apart; `sideEffects` fixes every barrel at once.
- **Raise the budget**: out of scope (#986), and it hides the cause.
- **Rewrite the guest-merge registration to explicit calls**: removes the side-effect imports altogether, but changes ADR 0009's merge wiring; listing the few files is enough.
