import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { scaled } from "./e2e/timeouts";

// Card worktrees carry their own ports and DB in .env (scripts/worktree.sh); a set variable still wins.
loadEnv({ path: [".env.local", ".env"], quiet: true });

/**
 * E2E + visual tests (docs/adr/0004). Viewports match the kit's UI contract: mobile, tablet, desktop.
 * Visual tests are tagged @visual and only run when PW_VISUAL=1 (CI runs them in the pinned
 * Playwright container so baselines are stable). Never update baselines to make a diff pass.
 */
const PORT = Number(process.env.PW_PORT ?? 3100);
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;
const RACE_PORT = Number(process.env.RACE_SERVER_PORT ?? 4000);
/** PW_WORKERS (integer >= 1) caps workers on a loaded machine (#629); unset keeps the Playwright default. */
const WORKERS = /^[1-9]\d*$/.test(process.env.PW_WORKERS ?? "")
  ? Number(process.env.PW_WORKERS)
  : undefined;

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: WORKERS,
  // test and assertion deadlines follow E2E_TIMEOUT_SCALE (e2e/timeouts.ts); default 1 = Playwright defaults
  timeout: scaled(30_000),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["line"]],
  grepInvert: process.env.PW_VISUAL ? undefined : /@visual/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  expect: {
    timeout: scaled(5_000),
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    timezoneId: "UTC",
    locale: "en-US",
  },
  projects: Object.entries(VIEWPORTS).map(([name, viewport]) => ({
    name,
    use: { ...devices["Desktop Chrome"], viewport },
  })),
  webServer: process.env.PW_BASE_URL
    ? undefined
    : [
        {
          // Race server (#165): Socket.IO must accept the Playwright origin, not the dev one. A reused
          // local `npm run dev:race` keeps its own WEB_ORIGIN, so stop it if browser sockets are refused.
          command: process.env.CI ? "node services/race-server/dist/main.js" : "npm run dev:race",
          url: `http://localhost:${RACE_PORT}/health`,
          env: { RACE_SERVER_PORT: String(RACE_PORT), WEB_ORIGIN: baseURL },
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: process.env.CI ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
          url: `${baseURL}/api/health`,
          // The web rate limiter (#207, ADR 0020) is off here: every browser context of the suite is
          // one client IP, so cookie-less joins and mints would share one bucket across tests. Its
          // behaviour is covered by src/server/limiter and src/features/lobby/actions tests.
          // REDIS_URL stays inherited: the production build requires it for the internal nonce
          // store (#716), which the race server's calls then exercise end to end.
          // PLAYWRIGHT_E2E marks this run: src/env.ts refuses WEB_RATE_LIMIT=off in production otherwise.
          // Placeholder OAuth apps (#49, #828): GitHub, Discord and Google register, so /sign-in shows their buttons and
          // e2e/auth/oauth.spec.ts intercepts the authorize redirect; no provider is ever reached.
          env: {
            WEB_RATE_LIMIT: "off",
            PLAYWRIGHT_E2E: "1",
            AUTH_GITHUB_ID: "e2e-github-client",
            AUTH_GITHUB_SECRET: "e2e-github-placeholder",
            AUTH_DISCORD_ID: "e2e-discord-client",
            AUTH_DISCORD_SECRET: "e2e-discord-placeholder",
            AUTH_GOOGLE_ID: "e2e-google-client",
            AUTH_GOOGLE_SECRET: "e2e-google-placeholder",
            // The colour-driven test moderator (ADR 0015, #60 C11): src/env.ts refuses it in production,
            // so only the local dev server takes it; CI's production build keeps the heuristic and the
            // moderation-verdict tests of e2e/identity/avatar.spec.ts skip there.
            ...(process.env.CI ? {} : { AVATAR_MODERATOR: "fake" }),
          },
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
