import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { scaled } from "../timeouts";
import { missionFor } from "../../src/features/stats/view/missions";
import {
  hints,
  locale,
  menu,
  missionDocket,
  openMenu,
  overlaps,
  playerDocket,
  withDb,
} from "./home-helpers";

// Contract of #943 part B (C18, C19, C20): the mission of the day docket and the star cell, from the
// viewer's counted results posted through the signed internal routes. Playwright runs in UTC while the
// stats day is Toronto's, so the expected template comes from the same pure function.

const DAY = 86_400_000;
const stars = (page: Page) => playerDocket(page).locator("[data-stars]");
const LINES: Record<string, string> = {
  "accuracy-95": "3 races at 95 % accuracy",
  "finish-3": "Finish 3 races",
  "accuracy-98": "1 race at 98 % accuracy",
};

/** `n` counted races of the page's guest at 99 % accuracy (they count for every template). */
async function races(page: Page, request: Parameters<typeof startRace>[0], n: number) {
  const lobby = await seedLobby(page);
  for (let i = 0; i < n; i++) {
    const desks: Desk[] = [
      { desk: 1, name: "Host", place: 1, wpm: 45, accuracy: 0.99, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: 2, wpm: 40, isBot: true },
    ];
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
  }
  return lobby.hostUserId;
}

test.describe("mission of the day (#943 C18-C20)", () => {
  test.setTimeout(scaled(120_000));

  test.beforeEach(async ({ page, context }) => {
    await locale(context, "en");
    await withoutWebGL(page);
  });

  test("C18 no race today reads 0 / target; after a counted race the count follows on reload", async ({
    page,
    request,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    const today = missionFor(new Date());
    const host = await races(page, request, 0);
    expect(host).toBeTruthy();
    await openMenu(page);
    const docket = missionDocket(page);
    await expect(docket).toHaveAttribute("data-mission-docket", today.id);
    await expect(docket).toContainText("MISSION OF THE DAY");
    await expect(docket).toContainText(LINES[today.id]!.replace(" %", " %"));
    await expect(docket.locator("[data-mission-count]")).toHaveText(`0 / ${today.target}`);
    await expect(docket.locator('[role="progressbar"] > span')).toHaveCount(today.target);
    await expect(stars(page)).toHaveAttribute("aria-label", "0 stars");

    // one counted race at 99 %: it counts for every template
    const lobby = await seedLobby(page);
    const desks: Desk[] = [
      { desk: 1, name: "Host", place: 1, wpm: 45, accuracy: 0.99, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: 2, wpm: 40, isBot: true },
    ];
    await postResults(request, await startRace(request, lobby, desks), desks);
    await openMenu(page);
    await expect(missionDocket(page).locator("[data-mission-count]")).toHaveText(
      `1 / ${today.target}`,
    );
    await expect(missionDocket(page).locator('[data-done="true"]')).toHaveCount(1);
    const complete = today.target === 1;
    await expect(missionDocket(page)).toHaveAttribute("data-complete", String(complete));
    if (complete) await expect(missionDocket(page)).toContainText("DONE");
  });

  test("C18 complete: every segment done, DONE and +1", async ({ page, request }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await races(page, request, 3);
    await openMenu(page);
    await expect(missionDocket(page)).toHaveAttribute("data-complete", "true");
    await expect(missionDocket(page).locator('[data-done="false"]')).toHaveCount(0);
    await expect(missionDocket(page).locator("[data-mission-done]")).toContainText("DONE");
    await expect(missionDocket(page).locator("[data-mission-done]")).toContainText("+1");
  });

  test("C19 two completed past days and not today read 2 stars", async ({ page, request }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    const host = await races(page, request, 6);
    // back-date: three results to noon Toronto (17:00Z) one day ago, three to two days ago
    const noon = (daysAgo: number) => {
      const d = new Date(Date.now() - daysAgo * DAY);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17));
    };
    await withDb(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM "RaceResult" WHERE "userId" = $1 ORDER BY "createdAt"`,
        [host],
      );
      expect(rows).toHaveLength(6);
      for (const [i, row] of rows.entries()) {
        await db.query(`UPDATE "RaceResult" SET "createdAt" = $1 WHERE id = $2`, [
          noon(i < 3 ? 1 : 2),
          row.id,
        ]);
      }
    });
    await openMenu(page);
    await expect(stars(page)).toHaveAttribute("aria-label", "2 stars");
    await expect(stars(page)).toHaveAttribute("data-stars", "2");
    await expect(missionDocket(page).locator("[data-mission-count]")).toHaveText(/^0 \/ \d$/);
  });

  test("C20 the docket overlaps neither the menu, the description nor the key-hint bar", async ({
    page,
    request,
  }) => {
    await races(page, request, 0);
    await openMenu(page);
    await expect(missionDocket(page)).toBeVisible();
    const docket = await missionDocket(page).boundingBox();
    for (const other of [
      menu(page).locator("ul"),
      page.locator("[data-home-description]"),
      hints(page),
    ]) {
      expect(overlaps(docket, await other.boundingBox())).toBe(false);
    }
  });

  test("C18 French: MISSION DU JOUR", async ({ page, context, request }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await races(page, request, 0);
    await locale(context, "fr");
    await openMenu(page);
    await expect(missionDocket(page)).toContainText("MISSION DU JOUR");
  });
});
