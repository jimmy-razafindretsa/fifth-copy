/**
 * Import boundaries from AGENTS.md "Architecture map":
 *   app -> features -> server/lib
 *   a feature imports another feature only through its index.ts
 *   components/ui imports nothing from features
 *   Prisma client only in src/server/**, src/features/*\/{queries,actions,jobs} and src/worker/**
 * Workspace boundaries (docs/adr/0005, 0006, 0007):
 *   packages/engine is pure (imports nothing outside itself)
 *   packages/protocol imports only zod and the engine
 *   services/race-server never imports the Next.js app (src/) and never Prisma
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
      comment: "Cross-feature imports must go through the other feature's index.ts.",
      severity: "error",
      from: { path: "^src/features/([^/]+)/" },
      to: {
        path: "^src/features/([^/]+)/.+",
        pathNot: ["^src/features/$1/", "^src/features/[^/]+/index\\.tsx?$"],
      },
    },
    {
      name: "app-feature-public-api-only",
      comment: "Routes compose features through their index.ts only.",
      severity: "error",
      from: { path: "^src/app/" },
      to: {
        path: "^src/features/[^/]+/.+",
        pathNot: "^src/features/[^/]+/index\\.tsx?$",
      },
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
      comment: "Workspace packages are consumed through their package entry point only.",
      severity: "error",
      from: { pathNot: "^packages/([^/]+)/" },
      to: { path: "^packages/[^/]+/src/(?!index\\.ts$).+" },
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
