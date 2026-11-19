/**
 * Import boundaries from AGENTS.md "Architecture map":
 *   app -> features -> server/lib
 *   a feature imports another feature only through its index.ts (or its server-only server.ts, ADR 0021,
 *   or its light client.ts, ADR 0026)
 *   components/ui imports nothing from features
 *   Prisma client only in src/server/**, src/features/*\/{queries,actions,jobs} and src/worker/**
 * Workspace boundaries (docs/adr/0005, 0006, 0007):
 *   packages/engine is pure (imports nothing outside itself)
 *   packages/protocol imports only zod and the engine
 *   packages/limiter imports only itself; only src/server/limiter and services/race-server use it (ADR 0020)
 *   services/race-server never imports the Next.js app (src/) and never Prisma
 *   src/worker imports only src/worker, src/features/*\/jobs, src/server and src/env.ts (ADR 0011)
 *   src/ never imports services/
 * Run via scripts/check.sh (depcruise src packages services).
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "ui-no-features",
      comment: "Design-system primitives must not depend on features.",
      severity: "error",
      from: { path: "^src/components/ui/" },
      to: { path: "^src/(features|app)/" },
    },
    {
      name: "components-no-server",
      comment: "UI components are client-safe: no server, db or env imports.",
      severity: "error",
      from: { path: "^src/components/" },
      to: { path: ["^src/server/", "^src/env\\.ts$", "^src/generated/"] },
    },
    {
      name: "lib-is-pure",
      comment: "src/lib holds pure utilities: no app, features, server or components imports.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/(app|features|server|components)/" },
    },
    {
      name: "server-no-upward",
      comment: "src/server must not import routes or features.",
      severity: "error",
      from: { path: "^src/server/" },
      to: { path: "^src/(app|features)/" },
    },
    {
      name: "features-no-app",
      comment: "Features must not import routes.",
      severity: "error",
      from: { path: "^src/features/" },
      to: { path: "^src/app/" },
    },
    {
      name: "feature-public-api-only",
      comment:
        "Cross-feature imports must go through the other feature's index.ts, its server-only server.ts (ADR 0021) or its light client.ts (ADR 0026).",
      severity: "error",
      from: { path: "^src/features/([^/]+)/" },
      to: {
        path: "^src/features/([^/]+)/.+",
        pathNot: [
          "^src/features/$1/",
          "^src/features/[^/]+/index\\.tsx?$",
          "^src/features/[^/]+/server\\.ts$",
          "^src/features/[^/]+/client\\.ts$",
        ],
      },
    },
    {
      name: "feature-server-entry-not-in-components",
      comment:
        "A feature's server.ts is server-only (ADR 0021): no component (src/components, src/features/*/components) imports one.",
      severity: "error",
      from: { path: ["^src/components/", "^src/features/[^/]+/components/"] },
      to: { path: "^src/features/[^/]+/server\\.ts$" },
    },
    {
      name: "feature-index-not-server-entry",
      comment:
        "A feature's index.ts stays client-safe (ADR 0021): it never imports or re-exports a server.ts, its own or another feature's.",
      severity: "error",
      from: { path: "^src/features/[^/]+/index\\.tsx?$" },
      to: { path: "^src/features/[^/]+/server\\.ts$" },
    },
    {
      name: "feature-testing-only-from-tests",
      comment:
        "A feature's testing/ folder is test support (#682): only *.test.ts(x) files and other testing/ modules import it.",
      severity: "error",
      from: { pathNot: ["\\.test\\.tsx?$", "/testing/"] },
      to: { path: "^src/features/.*/testing/" },
    },
    {
      name: "app-feature-public-api-only",
      comment:
        "Routes compose features through their index.ts (server code also through server.ts, ADR 0021; light client code through client.ts, ADR 0026).",
      severity: "error",
      from: { path: "^src/app/" },
      to: {
        path: "^src/features/[^/]+/.+",
        pathNot: [
          "^src/features/[^/]+/index\\.tsx?$",
          "^src/features/[^/]+/server\\.ts$",
          "^src/features/[^/]+/client\\.ts$",
        ],
      },
    },
    {
      name: "feature-client-entry-light",
      comment:
        "A feature's client.ts is its light client door (ADR 0026, #999): nothing reachable from it is the lobby store, the race socket client, socket.io or a server.ts. Zod is checked by scripts/landing-bundle.test.ts, which stops at server actions (their zod never reaches the browser; reachability here cannot).",
      severity: "error",
      from: { path: "^src/features/[^/]+/client\\.ts$" },
      to: {
        reachable: true,
        path: [
          "^src/features/lobby/components/lobby-store\\.ts$",
          "^src/features/race/client/socket\\.ts$",
          "^src/features/[^/]+/server\\.ts$",
          "node_modules/(socket\\.io-client|engine\\.io-client)/",
        ],
      },
    },
    {
      name: "visitor-landing-light-doors",
      comment:
        "The visitor landing module (/welcome, served for a cookieless /, ADR 0026) takes lobby UI through lobby/client.ts, never the lobby index.",
      severity: "error",
      from: { path: ["^src/app/welcome/", "^src/app/_components/landing-view\\.tsx$"] },
      to: { path: "^src/features/lobby/index\\.tsx?$" },
    },
    {
      name: "race-3d-imports",
      comment:
        "The seat scene reads only the race feature's index and the UI primitives; three.js stays in the embed page, never in a Next chunk (#563 C7, ADR 0017).",
      severity: "error",
      from: { path: "^src/features/race-3d/" },
      to: {
        path: ["^src/", "node_modules/three/"],
        pathNot: [
          "^src/features/race-3d/",
          "^src/features/race/index\\.tsx?$",
          "^src/components/ui/",
        ],
      },
    },
    {
      name: "race-3d-only-from-race-route",
      comment:
        "Only the race route (and the spectator link's projector, #999 C12) loads the seat scene, lazily after the HUD (#563 C7, ADR 0013, 0017).",
      severity: "error",
      from: { pathNot: ["^src/features/race-3d/", "^src/app/race/", "^src/app/watch/"] },
      to: { path: "^src/features/race-3d/" },
    },
    {
      name: "engine-is-pure",
      comment: "The race engine is deterministic and dependency-free (ADR 0007).",
      severity: "error",
      from: { path: "^packages/engine/" },
      to: { pathNot: "^packages/engine/" },
    },
    {
      name: "protocol-only-zod-and-engine",
      comment: "Protocol declares wire shapes: zod and engine types only (ADR 0006).",
      severity: "error",
      from: { path: "^packages/protocol/" },
      to: { pathNot: ["^packages/(protocol|engine)/", "node_modules/zod"] },
    },
    {
      name: "room-code-format-zod-free",
      comment:
        "@fifth-copy/protocol/room-code runs in client first loads (/, /lobby/[code]): type-only imports, no runtime zod (#675).",
      severity: "error",
      from: { path: "^packages/protocol/src/room-code-format\\.ts$" },
      to: { dependencyTypesNot: ["type-only"] },
    },
    {
      name: "limiter-is-self-contained",
      comment:
        "The shared limiter is pure TypeScript over an injected Redis client: it imports only its own files (ADR 0020). Its tests bring a real client.",
      severity: "error",
      from: { path: "^packages/limiter/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^packages/limiter/" },
    },
    {
      name: "limiter-consumers",
      comment:
        "Only the web adapter (src/server/limiter) and the race server use the limiter package; features go through src/server/limiter (ADR 0020).",
      severity: "error",
      from: { pathNot: ["^packages/limiter/", "^src/server/limiter/", "^services/race-server/"] },
      to: { path: "^packages/limiter/" },
    },
    {
      name: "web-redis-only-in-limiter",
      comment:
        "In the web app only the client factory (src/server/redis.ts) and the limiter adapter import ioredis (ADR 0020, #716).",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/server/(limiter/|redis\\.ts$)" },
      to: { path: "node_modules/ioredis/" },
    },
    {
      name: "race-server-no-web-app",
      comment:
        "The race server is a separate process: never the Next.js app, never Prisma (ADR 0006, 0008).",
      severity: "error",
      from: { path: "^services/race-server/" },
      to: {
        path: [
          "^src/",
          "^prisma/",
          "node_modules/(next|react|react-dom|@prisma)/",
          "node_modules/@prisma/",
        ],
      },
    },
    {
      name: "web-app-no-services",
      comment: "The web app talks to services over the network, never by import (ADR 0005).",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^services/" },
    },
    {
      name: "no-package-internals",
      comment:
        "Workspace packages are consumed through their package.json exports only: index.ts, plus @fifth-copy/protocol/room-code (#675).",
      severity: "error",
      from: { pathNot: "^packages/([^/]+)/" },
      to: {
        path: "^packages/[^/]+/src/.+",
        pathNot: [
          "^packages/[^/]+/src/index\\.ts$",
          "^packages/protocol/src/room-code-format\\.ts$",
        ],
      },
    },
    {
      name: "worker-imports",
      comment:
        "The worker (ADR 0011, #733) runs jobs: it imports only itself, feature jobs/ folders, src/server and the validated env.",
      severity: "error",
      from: { path: "^src/worker/", pathNot: "\\.test\\.ts$" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/worker/",
          "^src/features/[^/]+/jobs/",
          "^src/server/",
          "^src/env\\.ts$",
          "^src/generated/prisma/",
        ],
      },
    },
    {
      name: "prisma-only-in-server",
      comment:
        "Prisma client only in src/server/**, src/features/*/{queries,actions,jobs} and src/worker/** (ADR 0011).",
      severity: "error",
      from: {
        pathNot: [
          "^src/server/",
          "^src/features/[^/]+/(queries|actions|jobs)/",
          "^src/worker/",
          "^src/generated/",
          "^prisma/",
          "^scripts/",
          "^e2e/",
          "\\.test\\.tsx?$",
        ],
      },
      to: { path: ["^src/generated/prisma", "node_modules/@prisma/(client|adapter-pg)"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["^src/generated/", "\\.next/", "/dist/"] },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
