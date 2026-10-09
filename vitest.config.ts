import path from "node:path";
import { defineConfig } from "vitest/config";

const INCLUDE = [
  "src/**/*.test.{ts,tsx}",
  "scripts/**/*.test.ts",
  "packages/*/src/**/*.test.ts",
  "services/*/src/**/*.test.ts",
];
const EXCLUDE = ["node_modules", ".worktrees/**", "e2e/**", "**/dist/**"];

/**
 * Files that wait on spawned processes or a busy event loop (#600): child `tsx`/`git`/shell runs
 * and the race-server rooms driven by a fake clock over real Redis. They get a longer per-test
 * timeout so a loaded machine does not fail them; a hang still fails. File parallelism stays the
 * same as the default project, so Vitest schedules both in one group (a serial project would run
 * after the parallel one and lengthen the unit step).
 */
const SLOW_FILES = [
  "scripts/rename-user.test.ts",
  "scripts/deploy-smoke.test.ts",
  "scripts/merged-migrations.test.ts",
  "scripts/see.test.ts",
  "services/race-server/src/rooms/lifecycle.test.ts",
  "services/race-server/src/players/presence.test.ts",
  "services/race-server/src/rooms/snapshot.bench.test.ts",
];
const SLOW_TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside a React Server environment; tests run in plain Node.
      "server-only": path.resolve(__dirname, "scripts/lib/empty.ts"),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "default", include: INCLUDE, exclude: [...EXCLUDE, ...SLOW_FILES] },
      },
      {
        extends: true,
        test: {
          name: "slow",
          include: SLOW_FILES,
          exclude: EXCLUDE,
          testTimeout: SLOW_TEST_TIMEOUT_MS,
        },
      },
    ],
  },
});
