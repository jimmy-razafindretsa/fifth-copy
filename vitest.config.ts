import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside a React Server environment; tests run in plain Node.
      "server-only": path.resolve(__dirname, "scripts/lib/empty.ts"),
    },
  },
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
    ],
    exclude: ["node_modules", ".worktrees/**", "e2e/**", "**/dist/**"],
    environment: "node",
  },
});
