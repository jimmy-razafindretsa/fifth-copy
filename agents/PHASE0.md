# Phase 0 reference (from agent-kit.md)

## Scripts this kit expects (Phase 0 creates them)
- `scripts/check.sh`: lint, typecheck, boundary check, unit tests, ADR index freshness (`git diff --exit-code docs/adr/INDEX.json`). Prints <= 20 lines.
- `scripts/db-guard.sh`: exits non-zero unless `DATABASE_URL` host is localhost or a designated test host.
- `scripts/adr-index.ts`, `scripts/adr-governing.ts`: generated index and path-to-ADR lookup. ADR frontmatter: `id` (quoted string matching the filename prefix), `title`, `status` (proposed|accepted|superseded|rejected), `category`, `scope` (globs), `supersedes`, `rule` (one line).
- `scripts/board.ts`: the operations in PROTOCOL section 11 (GitHub GraphQL via `gh`), with `--dry-run` and read-after-write verification.
- `scripts/see.ts`: UI eyes (Playwright + axe) writing to `.eyes/<n>/` (gitignored).
- `scripts/deploy-smoke.sh`: minimal post-deploy checks.
- CI: lint/typecheck/unit, `prisma validate`, a migration check against a throwaway Postgres, Playwright e2e, visual tests in a pinned container image, ADR lint, boundary lint.
- CODEOWNERS: `docs/adr/**` and `AGENTS.md` require a human.

## Phase 0: the Foundations epic (Analyst always creates it first)
Typical cards, in dependency order (adjust to the project):
1. Scaffold: Next.js, TypeScript strict, lint, formatting, folder architecture, boundary lint, `src/env.ts`.
2. Prisma + Postgres: schema directory, local DB (docker compose), test DB strategy, migration flow, `db-guard`, seed.
3. CI pipeline: required checks, merge queue, preview deploy.
4. Tooling scripts: `check.sh`, `adr-*`, `board.ts`, `deploy-smoke.sh`. Mark `autonomy:hitl` until you trust them.
5. Playwright harness + `see.ts` + visual test job in a pinned image.
6. Design tokens + base UI primitives + `docs/design/components.md` (`ui`, `autonomy:hitl`: human approves direction).
7. Board config check: Project Status options (Backlog, Ready, In Progress, In Review, QA, Done), kit labels, Project automations that close or move items on merge disabled.
8. Auth/session skeleton, if the product needs it.
Nothing outside Foundations is picked until Foundations is Done.
