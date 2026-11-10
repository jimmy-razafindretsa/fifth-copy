import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// #875 C4: no dead links on the public screens. A link appears when its route ships (bible 14.1, 14.3):
// every internal link answers below 400, and no outside link is a bare site home page.

const PAGES = ["/", "/sign-in", "/sign-up", "/recover", "/settings", "/no-such-desk"] as const;

/** The distinct internal hrefs on the page, anchors stripped (`/#play` is `/`). */
async function internalHrefs(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator('a[href^="/"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
  return [...new Set(hrefs.map((href) => href.split("#")[0] || "/"))];
}

for (const locale of ["en", "fr"] as const) {
  test.describe(`public links in ${locale} (#875)`, () => {
    test.beforeEach(async ({ context }) => {
      const url = test.info().project.use.baseURL!;
      await context.addCookies([{ name: "locale", value: locale, url }]);
    });

    for (const path of PAGES) {
      test(`C4 every internal link on ${path} answers below 400`, async ({ page }) => {
        await page.goto(path);
        const hrefs = await internalHrefs(page);
        expect(hrefs.length, `links on ${path}`).toBeGreaterThan(0);
        for (const href of hrefs) {
          const response = await page.request.get(href);
          expect(response.status(), `${path} -> ${href}`).toBeLessThan(400);
        }
      });
    }

    test("C4 no outside link on / points at a bare site home page", async ({ page }) => {
      await page.goto("/");
      const outside = await page
        .locator('a[href^="http"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("href")!));
      for (const href of outside) {
        expect(new URL(href).pathname.replace(/\/+$/, ""), href).not.toBe("");
      }
    });
  });
}
