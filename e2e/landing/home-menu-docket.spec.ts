import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { scaled } from "../timeouts";
import {
  guest,
  hints,
  locale,
  menu,
  openMenu,
  overlaps,
  playerDocket,
  signInAccount,
} from "./home-helpers";

// Contract of #945: the player docket on the Home menu (rank from the mean clean WPM of the counted
// races, posted through the signed internal routes as e2e/profile/profile.spec.ts does).

const docket = playerDocket;

/** Three counted races of the page's account averaging 51.4 clean WPM. */
async function officer(page: Page, request: Parameters<typeof startRace>[0]) {
  const lobby = await seedLobby(page);
  for (const wpm of [40.2, 51.4, 62.6]) {
    const desks: Desk[] = [
      { desk: 1, name: "Host", place: 1, wpm, accuracy: 0.95, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: 2, wpm: 30, isBot: true },
    ];
    await postResults(request, await startRace(request, lobby, desks), desks);
  }
}

test.describe("player docket (#945)", () => {
  test.setTimeout(scaled(120_000));

  test.beforeEach(async ({ page }) => {
    await withoutWebGL(page);
  });

  test("C2 an account with three races at 51.4 reads OFFICER and 51 / 70 WPM → COMMISSAR", async ({
    page,
    context,
    request,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await locale(context, "en");
    const { username } = await signInAccount(page, "dock");
    await officer(page, request);
    await openMenu(page);
    await expect(docket(page)).toHaveAttribute("data-player-docket", "account");
    await expect(docket(page)).toContainText(username);
    await expect(docket(page).locator("[data-rank]")).toHaveText("OFFICER");
    await expect(docket(page).locator("[data-rank-line]")).toHaveText("51 / 70 WPM → COMMISSAR");
    const bar = docket(page).getByRole("progressbar", { name: "Progress to COMMISSAR" });
    await expect(bar).toHaveAttribute("aria-valuemin", "0");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
    await expect(bar).toHaveAttribute("aria-valuenow", "7");
    // C5: a link to the file named by the player, 44px tall
    const link = docket(page).getByRole("link", { name: `My file, ${username}` });
    await expect(link).toHaveAttribute("href", "/profile");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // C7: French
    await locale(context, "fr");
    await openMenu(page);
    await expect(docket(page).locator("[data-rank]")).toHaveText("OFFICIER");
    await expect(docket(page).locator("[data-rank-line]")).toContainText("MPM");
  });

  test("C2 an account with no race reads RECRUIT and 0 / 35 WPM → CLERK", async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await locale(context, "en");
    await signInAccount(page, "dock");
    await openMenu(page);
    await expect(docket(page).locator("[data-rank]")).toHaveText("RECRUIT");
    await expect(docket(page).locator("[data-rank-line]")).toHaveText("0 / 35 WPM → CLERK");
  });

  test("C4 a guest shows GUEST and no rank, bar or line, whatever its races", async ({
    page,
    context,
    request,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await locale(context, "en");
    await officer(page, request);
    await openMenu(page);
    await expect(docket(page)).toHaveAttribute("data-player-docket", "guest");
    await expect(docket(page).locator("[data-rank]")).toHaveText("GUEST");
    await expect(docket(page).getByRole("progressbar")).toHaveCount(0);
    await expect(docket(page).locator("[data-rank-line]")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`C5 axe clean with the docket (${theme})`, async ({ page, context }) => {
      test.skip(test.info().project.name !== "desktop", "desktop project only");
      await context.addCookies([
        { name: "theme", value: theme, url: test.info().project.use.baseURL! },
      ]);
      await signInAccount(page, "dock");
      await openMenu(page);
      await expect(docket(page)).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  test("C6 the docket overlaps neither the menu nor the key-hint bar; top right at 1280, above the menu at 375", async ({
    page,
    context,
  }) => {
    await guest(context);
    await openMenu(page);
    await expect(docket(page)).toBeVisible();
    const box = await docket(page).boundingBox();
    expect(overlaps(box, await menu(page).boundingBox())).toBe(false);
    expect(overlaps(box, await hints(page).boundingBox())).toBe(false);
    const project = test.info().project.name;
    if (project === "desktop") {
      expect(box!.x + box!.width).toBeGreaterThan(1180);
      expect(box!.y).toBeLessThan(80);
    }
    if (project === "mobile") {
      expect(box!.y + box!.height).toBeLessThanOrEqual((await menu(page).boundingBox())!.y);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  });
});
