import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // AGENTS.md: env access only through src/env.ts (validated).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/env.ts", "src/env.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Import { env } from '@/env' instead." },
      ],
    },
  },
  {
    // Race server: env only through services/race-server/src/env.ts; never the Next.js app (ADR 0006).
    files: ["services/race-server/**/*.ts"],
    ignores: ["services/race-server/src/env.ts", "services/race-server/src/**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Use parseEnv() from ./env instead." },
      ],
    },
  },
  {
    // Tests may read process.env (e.g. REDIS_URL for integration tests) but never import the app.
    files: ["services/race-server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["@/*", "next", "next/*", "react", "@prisma/*"] },
      ],
    },
  },
  {
    // Engine purity (ADR 0007): no runtime imports at all.
    files: ["packages/engine/**/*.ts"],
    ignores: ["packages/engine/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "^[^.]", message: "The engine imports only its own files (ADR 0007)." },
          ],
        },
      ],
    },
  },
  {
    // AGENTS.md: Prisma client never in client components / UI primitives.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["@prisma/*", "@/generated/*", "@/server/*", "@/features/*"] },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "public/3d/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    ".eyes/**",
    "packages/*/dist/**",
    "services/*/dist/**",
    ".worktrees/**",
    ".claude/**",
    // Design bible reference implementations: ported 1:1, never linted as app code.
    "docs/design/bible/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
