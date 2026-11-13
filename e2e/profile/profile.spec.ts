import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";

// Contract of #932 (C2, C9, C10): the Personnel file at /profile (bible 14.3, Profil.dc.html). A guest
// with no finished race sees the blank file (dashes, `--` tubes, the blank block); after three races
// (one won) posted through the signed internal routes on the page's own lobby, the service record
// counts them and the blank block is gone. Another browser never sees those figures. Without WebGL the
// stage shows the ID picture. One h1, axe-clean in both themes; a visitor with no file goes to sign-in.
// #933 C6: with three races the output curve shows after the service record and its slider works.

const screen = (page: Page) => page.locator("[data-profile-state]");
const figure = (page: Page, key: string) => page.locator(`[data-figure="${key}"] dd`);
const tubes = (page: Page) => page.locator("[data-tube]");
const blank = (page: Page) => page.locator("[data-blank]");
const curve = (page: Page) => page.locator("[data-curve]");

async function openFile(page: Page) {
  await page.goto("/profile");
  await expect(screen(page)).toBeVisible({ timeout: HYDRATION_WAIT });
}

/** Three finished races for the host, the second one won; best clean speed 61.4. */
async function threeRaces(
  request: Parameters<typeof startRace>[0],
  lobby: Awaited<ReturnType<typeof seedLobby>>,
) {
  const runs: [number, number][] = [
    [2, 40.2],
    [1, 61.4],
    [3, 52.5],
  ];
  for (const [place, wpm] of runs) {
    const desks: Desk[] = [
      { desk: 1, name: "Host", place, wpm, accuracy: 0.95, userId: lobby.hostUserId },
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

  test("C9 header: MY FILE / the docket links to the file, 44px, no sideways scroll", async ({
    page,
  }) => {
    await seedLobby(page);
    await openFile(page);
    const docket = page.locator("a[data-docket-link]");
    await expect(docket).toHaveAttribute("href", "/profile");
    expect((await docket.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const myFile = page.getByRole("link", { name: "MY FILE", exact: true });
    if (page.viewportSize()!.width > 480) {
      await expect(myFile).toHaveAttribute("aria-current", "page");
    }
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
    expect(order.indexOf("profile-curve")).toBe(order.indexOf("profile-service") + 1);
    const plot = curve(page).getByRole("img");
    await expect(plot).toHaveAccessibleName(
      /^3 races: speed from [\d.]+ to [\d.]+ WPM, accuracy from /,
    );
    const speed = curve(page).locator('[data-curve-line="speed"]');
    const dots = curve(page).locator("path").nth(2);
    const before = { line: await speed.getAttribute("d"), dots: await dots.getAttribute("d") };
    const slider = page.getByRole("slider", { name: "SMOOTHING" });
    await expect(slider).toHaveValue("3");
    expect((await slider.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Home is idempotent: repeat it until the hydrated slider has taken it
    await expect(async () => {
      await slider.focus();
      await page.keyboard.press("Home");
      await expect(curve(page).locator("[data-curve-value]")).toHaveText("0", {
        timeout: scaled(1_000),
      });
    }).toPass({ timeout: HYDRATION_WAIT });
    await expect(slider).toHaveValue("0");
    expect(await speed.getAttribute("d")).not.toBe(before.line);
    expect(await dots.getAttribute("d")).toBe(before.dots);
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
      await expectNoA11yViolations(page);
    });
  }
});
