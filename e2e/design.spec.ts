import { expect, expectNoA11yViolations, stabilize, test } from "./fixtures";

test.describe("design system page", () => {
  test("renders every primitive state accessibly", async ({ page }) => {
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Saving" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Saving" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByRole("alert")).toContainText("Could not save");
    await expectNoA11yViolations(page);
  });

  test("is keyboard navigable with visible focus", async ({ page }) => {
    await page.goto("/design");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus-visible");
    await expect(focused).toHaveText("Primary");
    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("has no horizontal overflow", async ({ page }) => {
    await page.goto("/design");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`visual baseline (${scheme}) @visual`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await stabilize(page);
      await page.goto("/design");
      await expect(page).toHaveScreenshot(`design-${scheme}.png`, {
        fullPage: true,
        mask: [page.getByRole("status", { name: "Loading" })],
      });
    });
  }
});
