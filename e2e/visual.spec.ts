import type { BrowserContext, Locator, Page } from "@playwright/test";
import { Client } from "pg";
import { expect, stabilize, test } from "./fixtures";
import { createLobby } from "./race/helpers";
import { HYDRATION_WAIT, scaled } from "./timeouts";

/**
 * #624 visual baselines (ADR 0004, pinned image via scripts/visual-baselines.sh): the landing, the lobby
 * entry (the waiting room as the host lands in it after CREATE PRIVATE RACE) and the form 404, at 375 and
 * 1280 (the tablet project is skipped), on paper and Night shift. Random content is masked or seeded: the
 * 3D embeds (`iframe`), the live feed's recorded loop and its random room number and timecode, the clerk's
 * random outfit rows, the room code, the roll and your seat; the host's guest name is seeded.
 */

const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];

/**
 * Night shift needs the saved choice on the landing (it opens on paper whatever the OS, bible 3.2, #651),
 * so each shot sets the `theme` cookie NIGHT SHIFT writes as well as the OS scheme.
 */
async function useScheme(page: Page, context: BrowserContext, scheme: Scheme) {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([{ name: "theme", value: scheme, url }]);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
}

/** The page's own fonts are in and the 3D frames have their boxes: nothing reflows under the shot. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Seeds the host's guest name: the generator picks animals of any length, and the header docket's width
 * (so the whole header row) follows it. The name is set to `Marmot-` + 3 random digits (unique column,
 * parallel shots), the same width in the monospace docket every run; the digits themselves stay masked.
 * No reload of the lobby page (a host reload can close the room): the caller opens a fresh lobby after it.
 */
async function seedHostName(page: Page): Promise<void> {
  const docket = page.getByRole("banner").getByText(/^Comrade \S+-\d{3}$/);
  const current = (await docket.textContent())!.replace(/^Comrade /, "");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = `Marmot-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
      const { rowCount } = await db.query(
        `UPDATE "User" SET "typistName" = $1 WHERE "typistName" = $2
           AND NOT EXISTS (SELECT 1 FROM "User" WHERE "typistName" = $1)`,
        [name, current],
      );
      if (rowCount === 1) break;
    }
  } finally {
    await db.end();
  }
}

/** Masks shared by every shot: 3D embeds and videos are never deterministic in the software renderer. */
const embeds = (page: Page): Locator[] => [page.locator("iframe"), page.locator("video")];

test.describe("#624 visual baselines", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === "tablet", "C1: 375 and 1280 only");
    // tall full-page shots in the pinned image's software renderer outgrow the 30s budget under load
    test.slow();
  });

  for (const scheme of SCHEMES) {
    test(`C1 landing (${scheme}) @visual`, async ({ page, context }) => {
      await useScheme(page, context, scheme);
      await stabilize(page);
      await page.goto("/");
      await expect(page.locator("section#play")).toBeVisible();
      await settled(page);
      const feed = page.locator("section#play").getByText(/ROOM \d+/);
      await expect(page).toHaveScreenshot(`landing-${scheme}.png`, {
        fullPage: true,
        timeout: scaled(45_000),
        mask: [
          ...embeds(page),
          feed,
          page.getByText(/STREAMING · Room \d+/),
          // the clerk docket lists the outfit the embed issues at random once its scene has drawn
          page.locator('section[aria-labelledby="clerk-title"] dl'),
        ],
      });
    });

    test(`C1 lobby entry (${scheme}) @visual`, async ({ page, context }) => {
      await useScheme(page, context, scheme);
      await stabilize(page);
      // the first lobby issues the guest; the seeded guest then opens the lobby under the shot
      await createLobby(page);
      await seedHostName(page);
      await createLobby(page);
      await expect(page.getByRole("banner").getByText(/^Comrade Marmot-\d{3}$/)).toBeVisible();
      const roll = page.getByRole("list", { name: "Typists in the room" });
      await expect(roll.getByRole("listitem")).toHaveCount(1, { timeout: HYDRATION_WAIT });
      await settled(page);
      await expect(page).toHaveScreenshot(`lobby-${scheme}.png`, {
        fullPage: true,
        timeout: scaled(45_000),
        mask: [
          ...embeds(page),
          page.getByRole("group", { name: "Room code" }),
          page.getByRole("banner").getByText(/^Comrade Marmot-\d{3}$/),
          page.locator('[data-seat-ring] [data-state="you"]'),
          roll,
        ],
      });
    });

    test(`C1 not found (${scheme}) @visual`, async ({ page, context }) => {
      await useScheme(page, context, scheme);
      await stabilize(page);
      await page.goto("/no-such-desk");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await settled(page);
      await expect(page).toHaveScreenshot(`not-found-${scheme}.png`, {
        fullPage: true,
        timeout: scaled(45_000),
        mask: embeds(page),
      });
    });
  }
});
