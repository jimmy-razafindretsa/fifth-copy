# Agent kit bootstrap progress

Source: `~/Downloads/agent-kit.md`. Branch: `chore/agent-kit-foundations`.
Any agent resuming this work: read this file first, continue at the first unchecked item, tick items as they land (with commit).

Placeholder values used: TEAM_KEY=`ENG` (change in AGENTS.md if your Linear team key differs), PKG=`npm` (binaries via `npx`), BASE_BRANCH=`main`, WIP_LIMIT=1, MAX_FIX_CYCLES=3, MAX_BLOCKED_STREAK=3, DIFF_BUDGET=~400 lines.

## Steps
- [x] 0. Split kit into files (AGENTS.md kept the `next dev` block; appendix saved as `agents/PHASE0.md`)
- [ ] 1. Scaffold: move app to `src/`, folder architecture, TS strict, prettier, boundary lint, `src/env.ts`
- [ ] 2. Prisma + Postgres: `prisma/schema/`, docker compose, test DB strategy, `scripts/db-guard.sh`, seed
- [ ] 3. Tooling scripts: `check.sh`, `adr-index.ts`, `adr-governing.ts`, first ADRs, `linear.ts`, `deploy-smoke.sh`, `loop.sh`
- [ ] 4. Unit test runner (vitest)
- [ ] 5. Playwright harness + `scripts/see.ts` + visual test config
- [ ] 6. Design tokens + base UI primitives + `docs/design/components.md`
- [ ] 7. CI pipeline (GitHub Actions) + CODEOWNERS + PR template
- [ ] 8. Linear workspace bootstrap script (states, labels) + Foundations epic/cards seed files
- [ ] 9. Final verification: `scripts/check.sh` green, `next build` green, e2e green

## Needs a human (cannot be done by an agent)
- Linear API key in `.env.local` (`LINEAR_API_KEY`) and confirm team key.
- GitHub: enable branch protection + required checks, disable "PR merged -> Done" in Linear's GitHub integration.
- Accept ADRs (only humans set `status: accepted`).
