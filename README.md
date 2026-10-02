# App (agent kit)

Next.js 16 (App Router) · Prisma 7 · PostgreSQL 17 · Linear · agent-agnostic delivery loop.

Agents: start with [AGENTS.md](AGENTS.md) (always loaded), then [agents/PROTOCOL.md](agents/PROTOCOL.md) plus **one** role file in [agents/roles/](agents/roles/).

## Setup
```bash
npm install                 # also runs prisma generate
cp .env.example .env        # Prisma CLI
cp .env.example .env.local  # Next.js (add LINEAR_API_KEY here)
npm run db:up               # local Postgres (docker compose), creates app + app_test
npx playwright install chromium
npm run dev
```

## Gates
| What | Command |
|---|---|
| Cheap gate (format, lint, types, boundaries, unit, ADR lint, prisma validate) | `scripts/check.sh` |
| E2E (mobile/tablet/desktop, console + network + axe) | `npm run e2e` |
| Visual (pinned Playwright image) | `scripts/visual-baselines.sh --check` |
| Look at a route | `npx tsx scripts/see.ts <ISSUE> <route>` |
| Post-deploy smoke | `scripts/deploy-smoke.sh [url]` |

## Starting the loop
1. `npx tsx scripts/linear.ts whoami`, then `npx tsx scripts/linear.ts bootstrap` (creates `Ready`, `QA` and kit labels).
2. `npx tsx scripts/linear-seed.ts work/plan/foundations.json` (Foundations epic, 7 cards, relations).
3. Human: add `plan-approved` to the epic, accept ADRs in `docs/adr/` you agree with.
4. Run Picker (`agents/roles/picker.md`) in your agent runtime, or `AGENT_CMD="claude -p" scripts/loop.sh`.

Bootstrap status and remaining human steps: [work/BOOTSTRAP_PROGRESS.md](work/BOOTSTRAP_PROGRESS.md).
