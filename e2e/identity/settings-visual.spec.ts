import { randomBytes } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, stabilize, test } from "../fixtures";
import { scaled } from "../timeouts";
import { deleteUsers, plantGuest } from "../auth/auth-helpers";
import { choose, openSettings, settingsDocket } from "./settings-helpers";

/**
 * #66 C9 visual baselines (ADR 0004, pinned image via scripts/visual-baselines.sh): `/settings` for a
 * guest with a layout chosen, at 375 and 1280 (the tablet project is skipped), on paper and Night shift.
 * The guest's typist name (random digits) is masked in the header and the account row.
 */

const SCHEMES = ["light", "dark"] as const;

async function useScheme(page: Page, context: BrowserContext, scheme: (typeof SCHEMES)[number]) {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([{ name: "theme", value: scheme, url }]);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
}

test.describe("#66 settings visual baselines", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === "tablet", "375 and 1280 only");
    test.slow();
  });

  for (const scheme of SCHEMES) {
    test(`C9 settings (${scheme}) @visual`, async ({ page, context }) => {
      const name = `Lynx-${100 + (randomBytes(2).readUInt16BE() % 900)}`;
      await deleteUsers(name);
      await plantGuest(context, name);
      await useScheme(page, context, scheme);
      await stabilize(page);
      await openSettings(page);
      await choose(page, "KEYBOARD LAYOUT", "AZERTY");
      // the save writes the stored theme as the cookie: put the shot's scheme back
      await choose(page, "THEME", scheme === "dark" ? "DARK" : "LIGHT");
      await page.reload();
      await openSettings(page);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`settings-${scheme}.png`, {
        fullPage: true,
        timeout: scaled(45_000),
        mask: [
          page.getByRole("banner").getByText(/^Comrade \S+-\d{3}$/),
          settingsDocket(page).locator("[data-account-name]"),
        ],
      });
      await deleteUsers(name);
    });
  }
});
