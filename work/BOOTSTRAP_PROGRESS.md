# Agent kit bootstrap progress

Source: `~/Downloads/agent-kit.md`. Branch: `chore/agent-kit-foundations` (local commits, not pushed).
Any agent resuming this work: read this file first, continue at the first unchecked item, tick items as they land (with commit).

Placeholder values used: TEAM_KEY=`AEG` (Linear team Aegis, project "fifth copy"), PKG=`npm` (binaries via `npx`), BASE_BRANCH=`main`, WIP_LIMIT=1, MAX_FIX_CYCLES=3, MAX_BLOCKED_STREAK=3, DIFF_BUDGET=~400 lines.

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

## Board moved to GitHub (2026-10-02)
- The tracker is now GitHub: issues in `jimmy-razafindretsa/fifth-copy` with native sub-issues and "blocked by" dependencies, all on the user Project "Fifth Copy" (#2). Status options Backlog, Ready, In Progress, In Review, QA, Done (real Ready/QA, no workarounds). Playbook: `agents/BOARD.md`.
- Old ids: AEG-1 -> #2 Foundations, AEG-2..AEG-8 -> #3..#9 (#9 is `needs-replan`, its contract was Linear-specific). 12 product epics and their issues/sub-issues were built from `work/plan/fifth-copy-requirements.md`; record in `work/plan/fifth-copy-board.json`.
- `scripts/linear.ts` / `linear-seed.ts` were replaced by `scripts/board.ts` / `board-seed.ts` (same ops plus `dump`, `import`, `link`, `verify`). The old AEG-* issues in Linear are left as they are; archiving them is the human's call.

## Linear (history: done 2026-10-02 via the Linear connector, superseded by the GitHub board above)
- Verified access to workspace `philJim`, team Aegis (`AEG`), project "fifth copy" (was empty).
- Created 23 labels (kit labels + `qa` + the 7 `area:*` used by Foundations). The team has no `Ready`/`QA` states and the connector cannot create states, so the kit is adapted: Ready = `Todo`, QA = `In Review` + `qa` (see `agents/BOARD.md`).
- Created epic AEG-1 Foundations and cards AEG-2..AEG-8 (Backlog, estimates, labels, `blocks` relations verified by re-reading). Cards are for Deliver to verify the existing work, not rebuild it.
- `docs/product-spec.md` holds the project description for the Analyst. No product epics exist yet.

## Needs a human (an agent cannot or must not do these)
1. Run `npx tsx scripts/board.ts bootstrap` once (creates the missing kit labels, including `plan-approved`; `--fields` adds the Estimate and Priority project fields), then add `plan-approved` to #2 (Picker will not promote cards until you do).
2. Keep the Project automations "Item closed", "Pull request merged" and "Auto-close issue" off (they are off on 2026-10-02; `bootstrap` reports them). Replan #9 for the GitHub board.
3. Open the PR for `chore/agent-kit-foundations`; set branch protection on `main` requiring `check`, `migrations`, `e2e`, `visual` and CODEOWNERS review; optionally enable merge queue (#8).
4. Review ADRs 0001-0004 in `docs/adr/` and set `status: accepted` on the ones you agree with (then `npm run adr:index`).
5. Approve the visual direction of the design tokens at `/design` (#7 C4).
6. Answer the open questions (`work/plan/fifth-copy-board.json` `stats.openQuestions`), approve product epics with `plan-approved`, then ask an agent to run the Analyst role to write their Contracts.
7. `gh auth login` (scopes `repo`, `project`) on any machine that runs `scripts/board.ts` or `loop.sh`. No API key goes in `.env*`.
8. Auth/session skeleton (Phase 0 item 8) is not built; it depends on the answer to the accounts question.

## Notes for the next agent
- Prisma 7: config lives in `prisma.config.ts` (datasource url + schema folder + seed). Generator `prisma-client` outputs to `src/generated/prisma` (gitignored, regenerated on `postinstall`). No models yet, so no migration exists; the first `touches:prisma` card creates it.
- Local DB: `npm run db:up` (docker compose, postgres:17). `app_test` DB is created by `prisma/docker-init/01-test-db.sql`.
- `npm audit` reports 4 high in Prisma CLI transitive deps (deepmerge-ts, mysql2). Dev-only; the offered fix is a downgrade to Prisma 6. Left as is.
- `npm run typecheck` = `next typegen && tsc` (LayoutProps/PageProps are generated).
- macOS ships bash 3.2: scripts avoid associative arrays and `${arr[@]}` on empty arrays.
- If the dev server reports "Can't resolve docs/design/tokens.css" after files move, delete `.next/` (stale Turbopack cache).
- `board.ts` read ops and `--dry-run` writes were run against the live GitHub board on 2026-10-02; real writes have not been exercised by the kit yet.
- Regenerate visual baselines only with `scripts/visual-baselines.sh` (same image as CI). Bump the image tag in `ci.yml` together with `@playwright/test`.
