import { defineConfig, devices } from "@playwright/test";

/**
 * E2E + visual tests (docs/adr/0004). Viewports match the kit's UI contract: mobile, tablet, desktop.
 * Visual tests are tagged @visual and only run when PW_VISUAL=1 (CI runs them in the pinned
 * Playwright container so baselines are stable). Never update baselines to make a diff pass.
 */
const PORT = Number(process.env.PW_PORT ?? 3100);
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;

export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["line"]],
  grepInvert: process.env.PW_VISUAL ? undefined : /@visual/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  expect: {
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
    : {
        command: process.env.CI ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
