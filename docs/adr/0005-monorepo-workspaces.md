---
id: "0005"
title: "npm workspaces: root Next.js app, shared packages/, separate services/"
status: accepted
category: architecture
scope: ["packages/**", "services/**", "package.json", "tsconfig.base.json", "next.config.ts", "vitest.config.ts", ".dependency-cruiser.cjs"]
supersedes: []
rule: The Next.js app stays at the repo root; shared code lives in packages/* (TypeScript source, consumed via @fifth-copy/*); other processes live in services/*; src/ never imports services/, services never import src/.
---

# 0005. npm workspaces: root Next.js app, shared `packages/`, separate `services/`

## Context
The spec (section 16.2) requires a real-time server that is a separate process from Next.js, and the race rules must run identically on that server and in the browser (prediction, replay, tests). ADR 0001 says a new top-level folder needs an ADR. Agents work one small card at a time, so the structure must make the boundaries obvious and machine-checked, and must not require a build step before `next dev` or Vitest can run.

## Decision
- The repository is an npm workspace. The **root package is the Next.js app** (unchanged commands: `npm run dev`, `scripts/check.sh`). `workspaces: ["packages/*", "services/*"]`.
- `packages/engine` (`@fifth-copy/engine`) and `packages/protocol` (`@fifth-copy/protocol`) ship **TypeScript source** (`exports` -> `src/index.ts`). Consumers compile them: Next.js via `transpilePackages`, Vitest and `tsx` natively, the race server via its esbuild bundle (`services/race-server/build.mjs`). No `dist/` is committed or required for development.
- `services/race-server` (`@fifth-copy/race-server`) is a separate Node 24 process with its own `package.json`, `tsconfig.json`, `env.ts`, `README.md`, dev (`npm run dev:race`) and build (`npm run build:race`) commands. Future processes follow the same shape under `services/`.
- Background jobs are **not** a service: they are a second entry point of the web package (`src/worker/`, ADR 0011), because they need Prisma and the feature modules.
- One `tsconfig.base.json` holds the strict options; each workspace extends it. The root `tsconfig.json` excludes `packages` and `services`; `scripts/check.sh` type-checks all of them (`npm run typecheck:workspaces`).
- Boundaries are enforced by dependency-cruiser over `src packages services` (rules `engine-is-pure`, `protocol-only-zod-and-engine`, `race-server-no-web-app`, `web-app-no-services`, `no-package-internals`) and by ESLint (`process.env` only in each process's `env.ts`).
- `esbuild` is an explicit devDependency (already a transitive dependency of `tsx`; same version, no native additions).

## Consequences
- A card that touches `packages/*` or `services/*` reads `docs/architecture/ARCHITECTURE.md` and this ADR first (see AGENTS.md session ritual).
- Workspace package versions are pinned to each other (`0.1.0`); bump `ENGINE_VERSION` / `PROTOCOL_VERSION` constants rather than package versions.
- Adding a workspace or a new runtime dependency to one is a `touches:deps` card.

## Alternatives considered
- **Single package, race server under `src/realtime/`:** no workspace tooling, but Next.js would bundle server code it never serves, and dependency-cruiser cannot tell "a different process" from "another module". Rejected.
- **Two repositories:** clean separation but the engine and protocol would be duplicated or published; cards could not change both sides atomically. Rejected.
- **Moving the app to `apps/web`:** symmetrical but churns every script, CI job and doc in the kit for no functional gain. Rejected for now; revisit only if a second web app appears.
- **pnpm / Turborepo:** faster installs and task graphs, but ADR 0004 fixed npm and the graph has three nodes. Not needed.
