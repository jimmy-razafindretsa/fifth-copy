import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // AGENTS.md: env access only through src/env.ts (validated).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/env.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Import { env } from '@/env' instead." },
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
    ".worktrees/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
