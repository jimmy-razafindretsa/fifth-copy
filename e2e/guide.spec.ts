import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import { guest, locale, withDb } from "./landing/home-helpers";

// #999 C26 (the "How to type it" page: entries, layout and OS, anchors, states, every viewport, both
// themes, axe), C27 (no pair is verified on main: every pair renders the empty state, never a key) and
// C28 (its own route; the header's guide link and the footer's point at it). Runs on all three viewports.

const CHARS = ["é", "è", "ê", "ë", "à", "â", "ç", "ù", "û", "ô", "î", "ï", "œ", "æ", "«", "»", "€"];
const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const theme = (context: BrowserContext, value: "light" | "dark") =>
  context.addCookies([{ name: "theme", value, url: test.info().project.use.baseURL! }]);

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const segment = (page: Page, group: string, name: string) =>
  page.getByRole("group", { name: group, exact: true }).getByRole("link", { name, exact: true });

test.describe("special-characters guide (#999 C26-C28)", () => {
  test.describe("macOS browser", () => {
    test.use({ userAgent: UA.mac });

    test("C26 C27 default: every character anchored, the locale's layout, the detected OS, all empty", async ({
      page,
    }) => {
      const response = await page.goto("/guide");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "HOW TO TYPE IT" })).toBeVisible();

      const sections = page.locator("main section[data-guide-char]");
      expect(
        await sections.evaluateAll((els) => els.map((el) => el.getAttribute("data-guide-char"))),
      ).toEqual(CHARS);
      await expect(page.locator("#c-cedilla h2")).toHaveText("ç · c cedilla");

      // the index links every anchor
      const index = page.getByRole("navigation", { name: "Characters" });
      await expect(index.getByRole("link")).toHaveCount(CHARS.length);

      // a visitor in English: US QWERTY; this browser says macOS
      await expect(segment(page, "KEYBOARD", "US QWERTY")).toHaveAttribute("aria-current", "true");
      await expect(segment(page, "SYSTEM", "MACOS")).toHaveAttribute("aria-current", "true");
      await expect(page.getByText("DETECTED ON THIS DEVICE")).toBeVisible();
      await expect(page.locator('[data-guide-pair="US_QWERTY/mac"]')).toHaveCount(CHARS.length);

      // C27: nothing is verified on a real machine yet: no key cap, the empty state everywhere
      await expect(page.locator("[data-guide-keys]")).toHaveCount(0);
      await expect(page.locator("[data-guide-unchecked]")).toHaveCount(CHARS.length);
      await expect(
        page.getByText("Nobody has typed these on a real US QWERTY keyboard under MACOS yet.", {
          exact: false,
        }),
      ).toBeVisible();

      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectNoA11yViolations(page);
    });

    test("C26 the OS and the layout can be overridden, and the choice is kept", async ({
      page,
    }) => {
      await page.goto("/guide");
      await segment(page, "SYSTEM", "CHROMEOS").click();
      await expect(page).toHaveURL(/\/guide\?layout=US_QWERTY&os=chromeos$/);
      await expect(segment(page, "SYSTEM", "CHROMEOS")).toHaveAttribute("aria-current", "true");
      await expect(page.getByText("CHOSEN BY YOU")).toBeVisible();

      await segment(page, "KEYBOARD", "AZERTY").click();
      await expect(page).toHaveURL(/\/guide\?layout=AZERTY&os=chromeos$/);
      await expect(page.locator('[data-guide-pair="AZERTY/chromeos"]')).toHaveCount(CHARS.length);
      await expect(page.locator("[data-guide-keys]")).toHaveCount(0);
    });

    test("C26 a deep link lands on its character", async ({ page }) => {
      await page.goto("/guide#c-cedilla");
      await expect(page.locator("#c-cedilla")).toBeInViewport();
    });

    test("C26 the layout defaults to the viewer's saved keyboard layout", async ({
      context,
      page,
    }) => {
      const { id } = await guest(context);
      await withDb((db) =>
        db.query(
          `INSERT INTO "Preference" ("userId", layout, "updatedAt") VALUES ($1, 'AZERTY', now())`,
          [id],
        ),
      );
      await page.goto("/guide");
      await expect(segment(page, "KEYBOARD", "AZERTY")).toHaveAttribute("aria-current", "true");
    });

    test("C26 in French on Night shift: CSA by default, the French copy, axe clean", async ({
      context,
      page,
    }) => {
      await locale(context, "fr");
      await theme(context, "dark");
      await page.goto("/guide");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.getByRole("heading", { level: 1, name: "COMMENT LE TAPER" })).toBeVisible();
      await expect(segment(page, "CLAVIER", "FRANÇAIS CANADIEN (CSA)")).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(page.locator("#c-cedilla h2")).toHaveText("ç · c cédille");
      await expect(page.locator("[data-guide-unchecked]").first()).toHaveText("PAS ENCORE VÉRIFIÉ");
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectNoA11yViolations(page);
    });
  });

  test.describe("unknown OS", () => {
    test.use({ userAgent: UA.linux });

    test("C26 the unknown-OS fallback lists every system per character and asks for one", async ({
      page,
    }) => {
      await page.goto("/guide");
      await expect(page.getByText("SYSTEM NOT DETECTED · PICK YOURS")).toBeVisible();
      for (const os of ["windows", "mac", "chromeos"]) {
        await expect(page.locator(`[data-guide-pair="US_QWERTY/${os}"]`)).toHaveCount(CHARS.length);
      }
      await expect(
        page.getByRole("group", { name: "SYSTEM", exact: true }).locator('[aria-current="true"]'),
      ).toHaveCount(0);
      await expect(page.locator("[data-guide-keys]")).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectNoA11yViolations(page);
    });
  });

  test("C28 the header's and the footer's guide links go to /guide", async ({ page }) => {
    await page.goto("/welcome");
    const guide = page.getByRole("banner").getByRole("link", { name: "HOW TO TYPE É Ç « »" });
    await expect(guide).toHaveAttribute("href", "/guide");
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "How to type é ç « »" }),
    ).toHaveAttribute("href", "/guide");
    await guide.click();
    await expect(page).toHaveURL(/\/guide$/);
    await expect(page.getByRole("heading", { level: 1, name: "HOW TO TYPE IT" })).toBeVisible();
  });
});
