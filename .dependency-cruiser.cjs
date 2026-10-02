/**
 * Import boundaries from AGENTS.md "Architecture map":
 *   app -> features -> server/lib
 *   a feature imports another feature only through its index.ts
 *   components/ui imports nothing from features
 *   Prisma client only in src/server/** and src/features/*\/{queries,actions}
 * Run via scripts/check.sh.
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
      name: "prisma-only-in-server",
      comment: "Prisma client only in src/server/** and src/features/*/{queries,actions}.",
      severity: "error",
      from: {
        pathNot: [
          "^src/server/",
          "^src/features/[^/]+/(queries|actions)/",
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
    exclude: { path: ["^src/generated/", "\\.next/"] },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
