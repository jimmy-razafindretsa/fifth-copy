import path from "node:path";
import { defineConfig } from "vitest/config";
import { unitRedisEnv } from "./scripts/lib/redis-env";

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
  // Boots the worker with tsx against the test database (#733 C3).
  "src/worker/main.test.ts",
  "services/race-server/src/rooms/lifecycle.test.ts",
  "services/race-server/src/players/presence.test.ts",
  // The readiness barrier over real sockets (#926): several races per test.
  "services/race-server/src/rooms/loading.test.ts",
  "services/race-server/src/rooms/snapshot.bench.test.ts",
  // 20 timed 10,000-name batches (#647): over the 5 s default when the machine is loaded.
  "src/features/texts/profanity/is-clean.test.ts",
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
    // A card worktree's unit run gets its own Redis db (REDIS_URL_TEST), not the e2e race server's (#680).
    env: unitRedisEnv(process.env),
    // next-auth imports `next/server` without the extension Node ESM needs; Vite resolves it when inlined (#786).
    server: { deps: { inline: ["next-auth"] } },
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
