# Agent kit bootstrap progress

Source: `~/Downloads/agent-kit.md`. Branch: `chore/agent-kit-foundations` (local commits, not pushed).
Any agent resuming this work: read this file first, continue at the first unchecked item, tick items as they land (with commit).

Placeholder values used: TEAM_KEY=`ENG` (change in AGENTS.md and `LINEAR_TEAM_KEY` in `.env*` if your Linear team key differs), PKG=`npm` (binaries via `npx`), BASE_BRANCH=`main`, WIP_LIMIT=1, MAX_FIX_CYCLES=3, MAX_BLOCKED_STREAK=3, DIFF_BUDGET=~400 lines.

## Steps (everything an agent can do is done)
- [x] 0. Split kit into files (AGENTS.md kept the `next dev` block; appendix saved as `agents/PHASE0.md`)
- [x] 1. Scaffold: app moved to `src/`, folder architecture, TS strict (+noUncheckedIndexedAccess), prettier, boundary lint (dependency-cruiser + eslint), `src/env.ts`
- [x] 2. Prisma 7 + Postgres 17: `prisma/schema/`, `prisma.config.ts`, docker compose, `app_test` DB, `scripts/db-guard.sh`, `scripts/test-db.sh`, seed, `/api/health`
- [x] 3. Tooling: `check.sh`, `adr-index.ts`, `adr-governing.ts`, ADRs 0001-0004 (proposed), `linear.ts` (all PROTOCOL 11 ops + `next`, `bootstrap`, `whoami`), `deploy-smoke.sh`, `loop.sh`
- [x] 4. Unit tests (Vitest): kit logic, ADR parsing, env, db-guard (25 tests)
- [x] 5. Playwright harness (console/network/axe auto-gates, 3 viewports) + `scripts/see.ts`
- [x] 6. Design tokens (`docs/design/tokens.css`, default Tailwind palette removed) + 7 primitives + `docs/design/components.md` + `/design`
- [x] 7. CI (`.github/workflows/ci.yml`: check, migrations + drift + immutability, e2e, visual in pinned image) + CODEOWNERS + PR template; baselines generated in the pinned image via `scripts/visual-baselines.sh`
- [x] 8. Linear: `linear.ts bootstrap` (states + labels) and `work/plan/foundations.json` + `scripts/linear-seed.ts` (Analyst self-check built in)
- [x] 9. Verified 2026-10-01: `scripts/check.sh` all green; `next build` ok; e2e 45/45 with `--repeat-each=3 --retries=0` in CI mode; visual 6/6 in pinned container; smoke ok on `next start`; seed ok; test-db ok; no schema drift

## Needs a human (an agent cannot or must not do these)
1. Put `LINEAR_API_KEY` in `.env.local`; confirm the team key (`npx tsx scripts/linear.ts whoami`).
2. `npx tsx scripts/linear.ts bootstrap --dry-run`, then without `--dry-run` (creates Ready/QA states and kit labels).
3. `npx tsx scripts/linear-seed.ts work/plan/foundations.json`, then add `plan-approved` to the Foundations epic.
4. In Linear's GitHub integration settings: disable "PR merged -> Done" for the team.
5. Push the branch and open the PR. Then in GitHub: branch protection on `main` requiring checks `check`, `migrations`, `e2e`, `visual` and CODEOWNERS review; optionally enable merge queue.
6. Review ADRs 0001-0004 in `docs/adr/` and set `status: accepted` on the ones you agree with (then `npm run adr:index`).
7. Approve the visual direction of the design tokens (look at `/design`). This is the Foundations design card's hitl criterion.
8. Auth/session skeleton (Phase 0 item 8) was not built: it depends on the product. The Analyst should add it to Foundations once `docs/product-spec.md` exists.

## Notes for the next agent
- Prisma 7: config lives in `prisma.config.ts` (datasource url + schema folder + seed). Generator `prisma-client` outputs to `src/generated/prisma` (gitignored, regenerated on `postinstall`). No models yet, so no migration exists; the first `touches:prisma` card creates it.
- Local DB: `npm run db:up` (docker compose, postgres:17). `app_test` DB is created by `prisma/docker-init/01-test-db.sql`.
- `npm audit` reports 4 high in Prisma CLI transitive deps (deepmerge-ts, mysql2). Dev-only; the offered fix is a downgrade to Prisma 6. Left as is.
- `npm run typecheck` = `next typegen && tsc` (LayoutProps/PageProps are generated).
- macOS ships bash 3.2: scripts avoid associative arrays and `${arr[@]}` on empty arrays.
- If the dev server reports "Can't resolve docs/design/tokens.css" after files move, delete `.next/` (stale Turbopack cache).
- `linear.ts` GraphQL fields were checked against Linear's published schema but have not run against a live workspace yet; the first run should be `whoami`, then `bootstrap --dry-run`.
- Regenerate visual baselines only with `scripts/visual-baselines.sh` (same image as CI). Bump the image tag in `ci.yml` together with `@playwright/test`.
