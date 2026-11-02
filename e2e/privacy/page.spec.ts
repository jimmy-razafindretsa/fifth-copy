import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, stabilize, test } from "../fixtures";

// Card #76 C5, C6, C7 (print), C8 (@visual) and C9: the privacy page, French first in the files, shown in the
// viewer's language (`locale` cookie, ADR 0010).

const IDS = [
  "collect",
  "why",
  "retention",
  "avatars",
  "delete",
  "responsible",
  "cookies",
  "third-parties",
  "rules",
];

// C9: What we collect, Why, How long we keep it, Who sees your picture, Delete my data, Who is responsible, Rules
const HEADINGS = {
  en: [
    "What we collect",
    "Why we collect it",
    "How long we keep it",
    "Who sees your picture",
    "Delete my data",
    "Who is responsible",
    "Rules (terms of use)",
  ],
  fr: [
    "Ce qu'on recueille",
    "Pourquoi on le recueille",
    "Combien de temps on le garde",
    "Qui voit ta photo",
    "Effacer mes données",
    "Qui est responsable",
    "Règles (conditions d'utilisation)",
  ],
} as const;

async function useLocale(page: Page, locale: "fr" | "en") {
  await page
    .context()
    .addCookies([{ name: "locale", value: locale, url: test.info().project.use.baseURL! }]);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("privacy page (#76)", () => {
  for (const locale of ["en", "fr"] as const) {
    test(`C5 C9 /privacy in ${locale}: every section with its anchor, the contents and <html lang>`, async ({
      page,
    }) => {
      await useLocale(page, locale);
      const response = await page.goto("/privacy");
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const sectionIds = await page
        .locator("main section[id]:not(section section)")
        .evaluateAll((els) => els.map((el) => el.id));
      expect(sectionIds).toEqual(IDS);

      for (const name of HEADINGS[locale]) {
        await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
      }

      // the table of contents links every section by its anchor
      const toc = page.getByRole("navigation", {
        name: locale === "fr" ? "Sur cette page" : "On this page",
      });
      const hrefs = await toc
        .getByRole("link")
        .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
      expect(hrefs).toEqual(IDS.map((id) => `#${id}`));

      // the conduct rules (#91) sit under `rules` with prefixed anchors
      await expect(page.locator("#rules #rules-avatars h3")).toBeVisible();

      await expectNoA11yViolations(page);
    });
  }

  test("C5 switching the locale cookie switches the text", async ({ page }) => {
    await useLocale(page, "en");
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 2, name: "Delete my data" })).toBeVisible();
    await useLocale(page, "fr");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(
      page.getByRole("heading", { level: 2, name: "Effacer mes données" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Delete my data" })).toHaveCount(0);
  });

  test("C6 C9 the landing footer links to /privacy; Delete my data links to /settings#account", async ({
    page,
  }) => {
    await page.goto("/");
    const link = page.locator('footer a[href="/privacy"]');
    await expect(link).toHaveCount(1);
    await page.goto("/privacy");
    await expect(page.locator('#delete a[href="/settings#account"]')).toBeVisible();
  });

  test("C7 print hides the navigation and keeps the text", async ({ page }) => {
    await page.goto("/privacy");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner").first()).toBeHidden();
    await expect(page.getByRole("navigation", { name: "On this page" })).toBeHidden();
    await expect(page.getByRole("link", { name: "BACK TO THE TOP ↑" }).first()).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#rules")).toBeVisible();
  });

  test("fits a phone without a horizontal scroll", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "phone width only");
    await page.goto("/privacy");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`visual baseline (${scheme}) @visual`, async ({ page }) => {
      test.slow();
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await stabilize(page);
      await page.goto("/privacy");
      await expect(page).toHaveScreenshot(`privacy-${scheme}.png`, {
        fullPage: true,
        timeout: 45_000,
      });
    });
  }
});
