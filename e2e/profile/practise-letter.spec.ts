import type { Page } from "@playwright/test";
import { Client } from "pg";
import { expect, test } from "../fixtures";
import { LOBBY_PATH } from "../race/helpers";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #999 C47 (#329, spec 13.3): from a key of the Personnel file's key sheet, "Practise this
// letter" opens the practice lobby of `createPracticeLobby` (private, two bots, the student its host)
// with that key as the only practice letter, in random words; the button lives in the key's detail,
// under the chips, and follows the selected key.

const keySheet = (page: Page) => page.locator('[data-section="key-sheet"]');
const settingsDocket = (page: Page) => page.getByRole("region", { name: "RACE SETTINGS" });
const setting = (page: Page, label: string) =>
  settingsDocket(page)
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("+ dd");
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });

/** Three counted races for the guest host, so the file shows its key sections. */
async function threeRaces(page: Page, request: Parameters<typeof startRace>[0]) {
  const lobby = await seedLobby(page);
  for (const [place, wpm] of [
    [2, 40.2],
    [1, 61.4],
    [3, 52.5],
  ] as const) {
    const desks: Desk[] = [
      { desk: 1, name: "Host", place, wpm, accuracy: 0.95, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: place === 1 ? 2 : 1, wpm: 50, isBot: true },
    ];
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
  }
  return lobby;
}

/** Key rows on the last three days: `e` met the goal, `ç` needs work. */
async function keyRows(userId: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    for (let i = 0; i < 3; i += 1) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      for (const [char, wpm] of [
        ["e", 42],
        ["ç", 20],
      ] as const) {
        await db.query(
          `INSERT INTO "CharStatDaily" ("userId", day, char, layout, hits, errors, "timedHits", "totalMs")
           VALUES ($1, $2::date, $3, 'FR_CA', 20, 1, 10, $4)`,
          [userId, day, char, Math.round(120_000 / wpm)],
        );
      }
    }
  } finally {
    await db.end();
  }
}

test.describe("#999 C47 Practise this letter", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project (phones watch, bible 18)");
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("from the key sheet, the selected key opens a practice race with it as the practice letter", async ({
    page,
    request,
  }) => {
    const lobby = await threeRaces(page, request);
    await keyRows(lobby.hostUserId);
    await page.goto("/profile");
    await expect(keySheet(page)).toBeVisible({ timeout: HYDRATION_WAIT });

    // the button sits in the key's detail and follows the chip picked
    const practise = keySheet(page).locator("[data-key-practise] button");
    await expect(practise).toHaveText("PRACTISE THIS LETTER · E");
    await keySheet(page).getByRole("button", { name: "Ç, needs work" }).click();
    await expect(practise).toHaveText("PRACTISE THIS LETTER · Ç");
    const box = (await practise.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);

    await practise.click();
    await page.waitForURL((url) => LOBBY_PATH.test(url.pathname), { timeout: scaled(20_000) });
    // the practice lobby: private, the student its host with two bots
    await expect(page.getByText("WAITING ROOM · PRIVATE RACE", { exact: true })).toBeVisible({
      timeout: scaled(10_000),
    });
    await expect(roll(page).getByRole("listitem")).toHaveCount(3, { timeout: scaled(10_000) });
    await expect(
      settingsDocket(page).getByRole("textbox", { name: "PRACTICE LETTERS" }),
    ).toHaveValue("ç");
    await expect(
      setting(page, "LANGUAGE").getByRole("button", { name: "FRENCH", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      setting(page, "TEXT TYPE").getByRole("button", { name: "RANDOM WORDS", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a plain letter practises in the UI language", async ({ page, request }) => {
    const lobby = await threeRaces(page, request);
    await keyRows(lobby.hostUserId);
    await page.goto("/profile");
    await expect(keySheet(page)).toBeVisible({ timeout: HYDRATION_WAIT });
    await keySheet(page).locator("[data-key-practise] button").click();
    await page.waitForURL((url) => LOBBY_PATH.test(url.pathname), { timeout: scaled(20_000) });
    await expect(
      settingsDocket(page).getByRole("textbox", { name: "PRACTICE LETTERS" }),
    ).toHaveValue("e", { timeout: scaled(10_000) });
    await expect(
      setting(page, "LANGUAGE").getByRole("button", { name: "ENGLISH", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
