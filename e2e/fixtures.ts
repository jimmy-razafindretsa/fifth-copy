import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared fixture: every test fails on console errors or failed requests (UI role rule:
 * zero console errors, zero failed requests). Use `expectNoA11yViolations` for axe.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.method()} ${r.url()}`));
      page.on(
        "response",
        (r) => r.status() >= 500 && errors.push(`http ${r.status()}: ${r.url()}`),
      );
      await use(errors);
      expect(errors, "console errors / failed requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Fails on serious or critical axe violations (WCAG 2.x A/AA). */
export async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const bad = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`);
  expect(bad, "serious/critical axe violations").toEqual([]);
}

/** Freeze time and disable animations before a visual assertion. */
export async function stabilize(page: Page, isoTime = "2026-01-01T12:00:00Z") {
  await page.clock.setFixedTime(new Date(isoTime));
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
}
