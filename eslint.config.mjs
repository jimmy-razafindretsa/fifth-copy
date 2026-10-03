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
    ignores: ["services/race-server/src/env.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Use parseEnv() from ./env instead." },
      ],
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
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    ".eyes/**",
    "packages/*/dist/**",
    "services/*/dist/**",
    ".worktrees/**",
    ".claude/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
