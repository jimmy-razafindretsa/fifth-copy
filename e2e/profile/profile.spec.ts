import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #932 (C2, C9, C10): the Personnel file at /profile (bible 14.3, Profil.dc.html). A guest
// with no finished race sees the blank file (dashes, `--` tubes, the blank block); after three races
// (one won) posted through the signed internal routes on the page's own lobby, the service record
// counts them and the blank block is gone. Another browser never sees those figures. Without WebGL the
// stage shows the ID picture. One h1, axe-clean in both themes; a visitor with no file goes to sign-in.
// #933 C6: with three races the output curve shows after the clean streaks and its slider works.
// #936 C5, C6: from three races the clean streaks follow the service record and the race archives close
// the page; three races against a bot only list newest first as BOTS, one MEDAL; phones scroll the
// archive table inside its own region, never the page.
// #337 C5: the grade ladder under the four figures: three races averaging 51.4 clean WPM hold Officer,
// 70 WPM away from Commissar, in English and French; a guest with no race holds Recruit.

const screen = (page: Page) => page.locator("[data-profile-state]");
const figure = (page: Page, key: string) => page.locator(`[data-figure="${key}"] dd`);
const tubes = (page: Page) => page.locator("[data-tube]");
const blank = (page: Page) => page.locator("[data-blank]");
const curve = (page: Page) => page.locator("[data-curve]");
const currentGrade = (page: Page) => page.locator('[data-ladder] li[aria-current="true"]');
const ladderLine = (page: Page) => page.locator("[data-ladder-line]");

async function openFile(page: Page) {
  await page.goto("/profile");
  await expect(screen(page)).toBeVisible({ timeout: HYDRATION_WAIT });
}

/**
 * Three finished races for the host against one bot, the second one won; best clean speed 61.4.
 * `accuracies` in race order (default 95 % each).
 */
async function threeRaces(
  request: Parameters<typeof startRace>[0],
  lobby: Awaited<ReturnType<typeof seedLobby>>,
  accuracies: [number, number, number] = [0.95, 0.95, 0.95],
) {
  const runs: [number, number][] = [
    [2, 40.2],
    [1, 61.4],
    [3, 52.5],
  ];
  for (const [i, [place, wpm]] of runs.entries()) {
    const accuracy = accuracies[i];
    const desks: Desk[] = [
      { desk: 1, name: "Host", place, wpm, accuracy, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: place === 1 ? 2 : 1, wpm: 50, isBot: true },
    ];
    const raceId = await startRace(request, lobby, desks);
    await postResults(request, raceId, desks);
  }
}

test.describe("Personnel file at /profile (#932)", () => {
  test.setTimeout(scaled(120_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    // the clerk's frame is not under test: the picture fallback keeps software GL out of the way
    await withoutWebGL(page);
  });

  test("C10 a visitor with no file is sent to sign in", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=(%2F|\/)profile$/);
  });

  test("C2 a fresh guest sees the blank file: dashes, -- tubes, the blank block", async ({
    page,
  }) => {
    await seedLobby(page);
    await openFile(page);
    await expect(screen(page)).toHaveAttribute("data-profile-state", /.+/);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("[data-guest-tag]")).toBeVisible();
    await expect(figure(page, "races")).toHaveText(/^0|—$/);
    await expect(figure(page, "bestSpeed")).toHaveText(/—$/);
    // speed and accuracy tubes are blank; the medal count is a known zero
    expect(await tubes(page).allTextContents()).toEqual(["--", "--", "--", "00"]);
    await expect(blank(page)).toBeVisible();
    await expect(page.locator('[data-stage-view="picture"]')).toBeVisible();
    // #337 C5: no race, Recruit
    await expect(currentGrade(page)).toHaveAttribute("data-grade", "recruit");
    await expect(currentGrade(page).locator("[aria-hidden]")).toHaveText("RECRUIT");
    await expect(ladderLine(page)).toHaveText("0.0 / 35 WPM → CLERK");
  });

  test("C5 (#337) three races averaging 51.4: OFFICER current, 70 to COMMISSAR, in both languages", async ({
    page,
    request,
    context,
  }) => {
    await threeRaces(request, await seedLobby(page));
    await openFile(page);
    await expect(currentGrade(page).locator("[aria-hidden]")).toHaveText("OFFICER");
    await expect(currentGrade(page)).toContainText("Officer, current grade");
    await expect(ladderLine(page)).toHaveText("51.4 / 70 WPM → COMMISSAR");
    await expect(page.getByRole("progressbar", { name: "Progress to Commissar" })).toBeVisible();
    await expect(page.getByRole("list", { name: "GRADE LADDER · BY YOUR AVERAGE" })).toBeVisible();

    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await openFile(page);
    await expect(currentGrade(page).locator("[aria-hidden]")).toHaveText("OFFICIER");
    await expect(ladderLine(page)).toHaveText("51,4 / 70 MPM → COMMISSAIRE");
  });

  test("C9 three races, one won: the record counts them; another browser never sees them", async ({
    page,
    request,
    browser,
  }) => {
    await threeRaces(request, await seedLobby(page));
    await openFile(page);
    await expect(figure(page, "races")).toHaveText("3");
    await expect(figure(page, "bestSpeed")).toContainText("61.4");
    await expect(figure(page, "wins")).toContainText("1");
    await expect(blank(page)).toHaveCount(0);
    expect(await tubes(page).allTextContents()).toEqual(["51", "61", "95.0", "01"]);

    const other = await browser.newContext();
    try {
      const url = test.info().project.use.baseURL!;
      await other.addCookies([{ name: "locale", value: "en", url }]);
      const stranger = await other.newPage();
      await withoutWebGL(stranger);
      await seedLobby(stranger);
      await openFile(stranger);
      await expect(figure(stranger, "races")).not.toHaveText("3");
      await expect(figure(stranger, "bestSpeed")).not.toContainText("61.4");
      await expect(blank(stranger)).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test("C9 header: the docket links to the file, 44px, no sideways scroll", async ({ page }) => {
    await seedLobby(page);
    await openFile(page);
    const docket = page.locator("a[data-docket-link]");
    await expect(docket).toHaveAttribute("href", "/profile");
    expect((await docket.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // #951: the separate MY FILE link is gone, the docket is the one link to the file
    await expect(page.getByRole("link", { name: "MY FILE", exact: true })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "sideways scroll").toBe(false);
  });

  // #933 C6: from three counted races the output curve follows the service record.
  test("C6 (#933) three races: the output curve, named for 3 races; the slider redraws from the keyboard", async ({
    page,
    request,
  }) => {
    await threeRaces(request, await seedLobby(page));
    await openFile(page);
    await expect(curve(page)).toBeVisible();
    const order = await page
      .locator("[data-profile-state] section[aria-labelledby]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-labelledby")));
    // #936: the clean streaks sit between the service record and the curve (bible 14.3)
    expect(order.indexOf("profile-streaks")).toBe(order.indexOf("profile-service") + 1);
    expect(order.indexOf("profile-curve")).toBe(order.indexOf("profile-streaks") + 1);
    const plot = curve(page).getByRole("img");
    await expect(plot).toHaveAccessibleName(
      /^3 races: speed from [\d.]+ to [\d.]+ WPM, accuracy from /,
    );
    const speed = curve(page).locator('[data-curve-line="speed"]');
    const dots = curve(page).locator("path").nth(2);
    const before = { line: await speed.getAttribute("d"), dots: await dots.getAttribute("d") };
    const slider = page.getByRole("slider", { name: "SMOOTHING" });
    // #951: no smoothing by default
    await expect(slider).toHaveValue("0");
    expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // End is idempotent: repeat it until the hydrated slider has taken it
    await expect(async () => {
      await slider.focus();
      await page.keyboard.press("End");
      await expect(curve(page).locator("[data-curve-value]")).toHaveText("8", {
        timeout: scaled(1_000),
      });
    }).toPass({ timeout: HYDRATION_WAIT });
    await expect(slider).toHaveValue("8");
    expect(await speed.getAttribute("d")).not.toBe(before.line);
    expect(await dots.getAttribute("d")).toBe(before.dots);
  });

  test("C6 (#936) three races against a bot: archive rows newest first, BOTS, one MEDAL; the 90 % streak", async ({
    page,
    request,
    browser,
  }) => {
    // in race order: 95 %, 97 %, 88 %: at 90 % the best run is 2 and the current run 0
    await threeRaces(request, await seedLobby(page), [0.95, 0.97, 0.88]);
    await openFile(page);
    const archive = page.locator('[data-section="archive"]');
    await expect(archive.getByRole("heading", { name: "Race archives" })).toBeVisible();
    await expect(archive).toContainText("ARCHIVES · LAST 3 ENTRIES");
    const rows = archive.locator("tbody tr");
    await expect(rows).toHaveCount(3);
    // newest first: the third race (place 3, 88 %), the won second, the first
    await expect(rows.nth(0)).toContainText("3 / 2");
    await expect(rows.nth(0)).toContainText("88.0 %");
    await expect(rows.nth(1)).toContainText("1 / 2");
    await expect(rows.nth(2)).toContainText("2 / 2");
    for (let i = 0; i < 3; i += 1)
      await expect(rows.nth(i).locator("td").nth(2)).toHaveText("BOTS");
    await expect(archive.locator('[data-award="medal"]')).toHaveCount(1);
    await expect(rows.nth(1).locator('[data-award="medal"]')).toHaveText("MEDAL");
    await expect(archive.locator('[data-award="podium"]')).toHaveCount(2);
    const at90 = page.locator('[data-streak="90"]');
    await expect(at90.locator("[data-streak-best]")).toHaveText("2");
    await expect(at90.locator("[data-streak-current]")).toHaveText("0");
    await expect(at90.locator("[data-streak-wpm]")).toHaveText("50.8");
    const order = await page
      .locator("[data-profile-state] section[aria-labelledby]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-labelledby")));
    expect(order.at(-1)).toBe("profile-archive");

    const other = await browser.newContext();
    try {
      const url = test.info().project.use.baseURL!;
      await other.addCookies([{ name: "locale", value: "en", url }]);
      const stranger = await other.newPage();
      await withoutWebGL(stranger);
      await seedLobby(stranger);
      await openFile(stranger);
      await expect(stranger.locator('[data-section="archive"]')).toHaveCount(0);
      await expect(stranger.locator('[data-section="streaks"]')).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  test("C5 (#936) on a phone the archive scrolls inside its own region, never the page", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await threeRaces(request, await seedLobby(page));
    await openFile(page);
    const region = page.getByRole("region", { name: "Race archives, scrolls sideways" });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("tabindex", "0");
    const box = await region.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(box.scroll).toBeGreaterThan(box.client);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "sideways scroll").toBe(false);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C9 axe-clean in ${scheme}, blank and filled`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const lobby = await seedLobby(page);
      await openFile(page);
      await expectNoA11yViolations(page);
      await threeRaces(request, lobby);
      await openFile(page);
      await expect(figure(page, "races")).toHaveText("3");
      await expect(curve(page)).toBeVisible();
      await expect(page.locator('[data-section="archive"]')).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }
});
