---
id: "0018"
title: First-load JS budget raised to 300 kB gzip (amends ADR 0013's bundle clause)
status: accepted
category: ui
scope: ["scripts/bundle-budget.ts", "scripts/bundle-budget.test.ts", "src/app/race/**", "src/app/lobby/**", "e2e/perf/**"]
supersedes: []
rule: An App Router route's first-load JS without the 3D chunk stays at or under 300 kB gzip (BUDGET_KB in scripts/bundle-budget.ts, one limit for every route); this replaces only ADR 0013's 250 kB figure, whose other budgets (three only in the race-3d chunk, fps, draw calls, time to race) stay as written.
---

# 0018. First-load JS budget raised to 300 kB gzip (amends ADR 0013's bundle clause)

## Context
ADR 0013 ("Budgets in CI") set the race route's first-load JS without the 3D chunk under 250 kB gzip. Card #521 made it measurable (`scripts/bundle-budget.ts`, `BUDGET_KB`, one limit for every route: root main files + layouts + page entry files, deduped, gzip level 9). After #559 (race input and local prediction) the measured first loads were `/race/[raceId]` 244.9 kB and `/lobby/[code]` 241.5 kB (re-measured on #646's production build: 244.9 kB and 241.4 kB), on a shared baseline of about 226 kB (zod on the client is ~91 kB of it, follow-up #626). The seat-view cards still to come add client code to the race route: #220 the teleprinter's error modes, #224 the layouts and key motion, then the later race HUD cards. About 5 kB of headroom would have turned each of them into a slimming card.

## Decision
The owner decided on 2026-10-16 (card #646) to raise the first-load JS budget from 250 kB to **300 kB gzip**, the 3D chunk still excluded. `BUDGET_KB = 300` in `scripts/bundle-budget.ts`; the script exits 1 above it. The same limit applies to every measured route (`/race/[raceId]`, `/lobby/[code]`).

This amends ADR 0013's bundle clause only. Unchanged from ADR 0013: `three` and its loaders live only in the lazily loaded `race-3d` chunk; >= 30 fps median at the Low preset with 60 bots; <= 60 draw calls; landing to a started bot race under 60 s.

## Consequences
- About 55 kB of headroom on the race route (244.9 kB measured) for #220, #224 and the race HUD cards, with no slimming work.
- Slimming stays welcome but is no longer a blocker; #626 (zod off the landing client) keeps its own value.
- `docs/architecture/ARCHITECTURE.md` section 10 states 300 kB and links this ADR; ADR 0013 points here.
- Anyone reading ADR 0013's 250 kB figure follows this ADR for the number (both govern `src/app/race/**` and `e2e/perf/**`).

## Alternatives considered
- **Keep 250 kB and slim on every card**: the shared baseline (~226 kB) leaves no room for the race HUD; each card would carry unrelated bundle work. The owner chose to raise the limit instead.
- **Per-route budgets** (race higher, lobby lower): more configuration for little gain while both routes sit within 4 kB of each other. Out of scope for #646.
- **Supersede ADR 0013**: only one figure changes; the rest of 0013 stays in force, so this ADR amends it instead (`supersedes: []`).
