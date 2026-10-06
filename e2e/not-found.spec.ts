import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// Card 397 (not-found part): the in-world form 404 with the Major in 3D (bible 10.3, 14.3).
const TITLE = "ARE YOU LOST, KID?";
const TITLE_FR = "T'ES PERDU, LE JEUNE ?";
const MISSING = "/no-such-desk";

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("not found (#397)", () => {
  test("C1 an unknown route answers 404 with the form-404 docket and the two ways back", async ({
    page,
  }) => {
    const response = await page.goto(MISSING);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText("MINISTRY OF TYPING · FORM 404")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "FILE NOT FOUND" })).toBeVisible();
    await expect(page.locator("dd")).toHaveText(["404", "NOT ON FILE", "UNASSIGNED"]);
    await expect(page.getByRole("link", { name: "REPORT TO YOUR DESK" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: "JOIN WITH CODE →" })).toHaveAttribute(
      "href",
      "/#play",
    );
    await expect(page.locator("header")).toBeVisible();
  });

  test("C2 the Major's embed is the local reference page in a titled, lazily mounted frame", async ({
    page,
    request,
  }) => {
    await page.goto(MISSING);
    const frame = page.locator("iframe");
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute("title", "The Major, watching, in 3D");
    await expect(frame).toHaveAttribute("data-embed", "mounted", { timeout: 30_000 });
    await expect(frame).toHaveAttribute("src", "/3d/major.html");
    const res = await request.get("/3d/major.html");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("/3d/vendor/three.module.min.js");
    expect(html).not.toMatch(/unpkg|googleapis/);
    await expect(page.getByText("THE MAJOR · HE'S WATCHING YOUR CURSOR")).toBeVisible();
  });

  test("C3 the stamp slams in at -6° and stays still under reduced motion", async ({ page }) => {
    await page.goto(MISSING);
    const stamp = page.getByRole("status").filter({ hasText: "FILE NOT FOUND" });
    expect(await stamp.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/fcSlam$/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const still = page.getByRole("status").filter({ hasText: "FILE NOT FOUND" });
    expect(await still.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await still.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  });

  test("C4 French through the header toggle", async ({ page }) => {
    await page.goto(MISSING);
    await expect(page.locator("iframe")).toHaveAttribute("data-embed", "mounted", {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "FR", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: TITLE_FR })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("status").filter({ hasText: "DOSSIER INTROUVABLE" })).toBeVisible();
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible({
      timeout: 20_000,
    });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C5 ${scheme}: accessible, no horizontal scroll`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(MISSING);
      await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
      await expectNoA11yViolations(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
});
