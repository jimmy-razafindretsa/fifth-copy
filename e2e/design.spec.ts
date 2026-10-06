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
    // Next.js injects a route announcer with role="alert"; always filter alerts by text.
    await expect(page.getByRole("alert").filter({ hasText: "Could not save" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("renders accessibly in the dark scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    const scheme = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
    expect(scheme).toBe(true);
    await expectNoA11yViolations(page);
  });

  for (const [scheme, bg, fg] of [
    ["light", "rgb(241, 232, 214)", "rgb(42, 36, 32)"],
    ["dark", "rgb(62, 57, 52)", "rgb(244, 236, 220)"],
  ] as const) {
    test(`paints the Fifth Copy ${scheme} ground and ink`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/design");
      const body = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { bg: style.backgroundColor, fg: style.color };
      });
      expect(body).toEqual({ bg, fg });
    });
  }

  test("shows every colour role with its name and the typing and device samples", async ({
    page,
  }) => {
    await page.goto("/design");
    const section = page.getByRole("region", { name: "Colour roles" });
    await expect(section.getByRole("heading", { level: 2, name: "Colour roles" })).toBeVisible();
    const roles = [
      "bg",
      "surface",
      "surface-muted",
      "fg",
      "fg-muted",
      "border",
      "primary",
      "primary-hover",
      "primary-fg",
      "pressed",
      "danger",
      "danger-surface",
      "success",
      "success-surface",
      "focus",
      "link",
      "you",
      "rival",
      "reward",
      "untyped",
      "room",
      "tape",
      "typing-done",
      "typing-next",
      "typing-next-bg",
      "typing-remaining",
      "typing-error",
      "device-phosphor",
      "device-nixie",
      "device-bezel",
    ];
    await expect(section.locator("[data-role]")).toHaveCount(roles.length);
    for (const role of roles) {
      await expect(section.locator(`[data-role="${role}"]`)).toHaveText(role);
    }
    await expect(section.locator('[data-sample="typing"]')).toHaveText("Type fast. Tupe first.");
    await expect(section.locator('[data-sample="device"]')).toBeVisible();
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
