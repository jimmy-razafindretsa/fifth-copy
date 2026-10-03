# App (agent kit)

Next.js 16 (App Router) · Prisma 7 · PostgreSQL 17 · Socket.IO race server · Redis · GitHub Issues + Projects · agent-agnostic delivery loop.

Architecture: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) (web app at the root, `packages/engine` + `packages/protocol` shared, `services/race-server` separate process; ADRs 0005-0013).

Agents: start with [AGENTS.md](AGENTS.md) (always loaded), then [agents/PROTOCOL.md](agents/PROTOCOL.md) plus **one** role file in [agents/roles/](agents/roles/).

## Setup
```bash
npm install                 # also runs prisma generate
cp .env.example .env        # Prisma CLI
cp .env.example .env.local  # Next.js
gh auth login               # board access for scripts/board.ts (scopes repo, project)
npm run db:up               # local Postgres + Redis (docker compose), creates app + app_test
npx playwright install chromium
npm run dev                 # web app
npm run dev:race            # race server (separate terminal), http://localhost:4000/health
```

## Gates
| What | Command |
|---|---|
| Cheap gate (format, lint, types, boundaries, unit, ADR lint, prisma validate) | `scripts/check.sh` |
| E2E (mobile/tablet/desktop, console + network + axe) | `npm run e2e` |
| Visual (pinned Playwright image) | `scripts/visual-baselines.sh --check` |
| Look at a route | `npx tsx scripts/see.ts <n> <route>` |
| Post-deploy smoke | `scripts/deploy-smoke.sh [url]` |

## Starting the loop
1. The board is GitHub: issues in [jimmy-razafindretsa/fifth-copy](https://github.com/jimmy-razafindretsa/fifth-copy/issues) on the Project [Fifth Copy](https://github.com/users/jimmy-razafindretsa/projects/2) (epic #2 Foundations with cards #3-#9, plus 12 product epics). Read `agents/BOARD.md` for the Status mapping and the `scripts/board.ts` / `gh` calls.
2. Human, once: `npx tsx scripts/board.ts bootstrap` (creates the missing kit labels, including `plan-approved`; add `--fields` for the Estimate and Priority fields).
3. Human: add `plan-approved` to #2, accept ADRs in `docs/adr/` you agree with.
4. Run Picker (`agents/roles/picker.md`) in your agent runtime, or `AGENT_CMD="claude -p" scripts/loop.sh`.

Bootstrap status and remaining human steps: [work/BOOTSTRAP_PROGRESS.md](work/BOOTSTRAP_PROGRESS.md).
