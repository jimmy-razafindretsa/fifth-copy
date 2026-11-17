import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { type Desk, postResults, seedLobby, startRace, withoutWebGL } from "../results/helpers";
import { signInAccount } from "../landing/home-helpers";
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
// #969 C4, C5, C6: the site header's grade tag: an account averaging 51.4 reads OFFICER after its name on
// the landing and on /profile, in both languages; it arrives with no layout shift; the longest grade name
// fits at 768 and 1280 and hides at 375, where the docket link still says the grade.

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

/** Three counted races for the page's account, at these clean speeds. */
async function accountRaces(
  page: Page,
  request: Parameters<typeof startRace>[0],
  speeds: [number, number, number],
) {
  const lobby = await seedLobby(page);
  for (const wpm of speeds) {
    const desks: Desk[] = [
      { desk: 1, name: "Host", place: 1, wpm, accuracy: 0.95, userId: lobby.hostUserId },
      { desk: 2, name: "Typist Bot", place: 2, wpm: 30, isBot: true },
    ];
    await postResults(request, await startRace(request, lobby, desks), desks);
  }
}

const gradeTag = (page: Page) => page.getByRole("banner").locator("[data-docket-grade]");
const docketLink = (page: Page) => page.getByRole("banner").locator("a[data-docket-link]");

/**
 * The header's geometry: its height, and the box of every header item but the docket (brand, ← MENU,
 * guide, toggles, SIGN OUT), rounded to the pixel.
 */
async function headerLayout(page: Page) {
  return page.getByRole("banner").evaluate((header) => {
    const items = [...header.querySelectorAll("a, button")].filter(
      (el) => !el.closest("[data-docket-link]"),
    );
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.top), Math.round(r.bottom), Math.round(r.right)];
    };
    return { height: Math.round(header.getBoundingClientRect().height), items: items.map(box) };
  });
}

test.describe("site header grade tag (#969)", () => {
  test.setTimeout(scaled(120_000));

  test.beforeEach(async ({ page }) => {
    await withoutWebGL(page);
  });

  test("C6 an account averaging 51.4 reads OFFICER / OFFICIER in the header on the landing and /profile", async ({
    page,
    context,
    request,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    const { username } = await signInAccount(page, "grade");
    await accountRaces(page, request, [40.2, 51.4, 62.6]);
    // an account's `/` is the Home menu (no site header, bible 14.5): the landing lives at /welcome
    for (const path of ["/welcome", "/profile"]) {
      await page.goto(path);
      await expect(gradeTag(page)).toHaveText("OFFICER");
      await expect(gradeTag(page)).toHaveAttribute("data-docket-grade", "officer");
      await expect(docketLink(page)).toHaveAccessibleName(
        `My file, Comrade ${username}, grade: Officer`,
      );
    }
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    for (const path of ["/welcome", "/profile"]) {
      await page.goto(path);
      await expect(gradeTag(page)).toHaveText("OFFICIER");
      await expect(docketLink(page)).toHaveAccessibleName(
        `Mon dossier, Camarade ${username}, grade : Officier`,
      );
    }
    // the Home menu at / keeps its own docket's rank tag (#945)
    await page.goto("/");
    await expect(page.locator("[data-player-docket] [data-rank]")).toHaveText("OFFICIER");
  });

  test("C4 the tag arrives with no layout shift in the header", async ({ page, request }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    await signInAccount(page, "grade");
    await accountRaces(page, request, [40.2, 51.4, 62.6]);
    // the header as first painted: recorded the moment the parser has closed it, before any script runs
    await page.addInitScript(() => {
      const w = window as unknown as { __firstHeader?: unknown };
      const record = () => {
        const header = document.querySelector("header");
        if (!header || w.__firstHeader) return;
        const items = [...header.querySelectorAll("a, button")].filter(
          (el) => !el.closest("[data-docket-link]"),
        );
        w.__firstHeader = {
          height: Math.round(header.getBoundingClientRect().height),
          items: items.map((el) => {
            const r = el.getBoundingClientRect();
            return [Math.round(r.top), Math.round(r.bottom), Math.round(r.right)];
          }),
        };
      };
      document.addEventListener("DOMContentLoaded", record);
    });
    await page.goto("/profile");
    await expect(gradeTag(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const first = await page.evaluate(
      () => (window as unknown as { __firstHeader?: unknown }).__firstHeader,
    );
    expect(first).toBeTruthy();
    expect(await headerLayout(page)).toEqual(first);
  });

  // C5 at the longest username (20 characters) with the longest grade name: the tag adds no row and no
  // overflow at 1280 (one row) and 768 (the docket's own row, as today); at 375 it hides, still spoken.
  test("C5 the longest grade name fits at 1280 and 768 and hides at 375, still spoken", async ({
    page,
    context,
    request,
  }) => {
    test.skip(test.info().project.name !== "desktop", "desktop project only");
    const { username } = await signInAccount(page, "gradewidest");
    await accountRaces(page, request, [92, 95, 98]);
    const url = test.info().project.use.baseURL!;
    const LOCALES = [
      {
        locale: "fr",
        named: `Mon dossier, Camarade ${username}, grade : Héros de la paperasse`,
        tag: "HÉROS DE LA PAPERASSE",
      },
      {
        locale: "en",
        named: `My file, Comrade ${username}, grade: Hero of paperwork`,
        tag: "HERO OF PAPERWORK",
      },
    ];
    for (const { locale, named, tag: tagText } of LOCALES)
      for (const width of [1280, 768, 375]) {
        await context.addCookies([{ name: "locale", value: locale, url }]);
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/profile");
        await expect(docketLink(page)).toHaveAccessibleName(named);
        const header = page.getByRole("banner");
        const fit = await header.evaluate((h) => ({
          scroll: h.scrollWidth,
          client: h.clientWidth,
          page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          height: h.getBoundingClientRect().height,
        }));
        expect(fit.scroll, `header overflow at ${width} ${locale}`).toBeLessThanOrEqual(fit.client);
        expect(fit.page, `sideways scroll at ${width}`).toBe(false);
        if (width === 375) {
          await expect(gradeTag(page)).toBeHidden();
          // the phone rule's two rows stay under 120px (bible 14.1 item 1)
          expect(fit.height).toBeLessThan(120);
          continue;
        }
        await expect(gradeTag(page)).toHaveText(tagText);
        // the tag sits on the name's line, inside the docket
        const docket = (await docketLink(page).boundingBox())!;
        const tag = (await gradeTag(page).boundingBox())!;
        const middle = (b: { y: number; height: number }) => Math.round(b.y + b.height / 2);
        expect(middle(tag), `tag line at ${width}`).toBe(middle(docket));
        expect(tag.x + tag.width).toBeLessThanOrEqual(docket.x + docket.width);
        // no row added: the header is no taller than today's (no tag, the name uncut); one row at 1280
        if (width === 1280) {
          expect(fit.height, "one row at 1280").toBeLessThan(80);
          // with room to spare: CI's fonts set the row about 18px wider than a dev machine's
          const spare = await page.addStyleTag({ content: "header nav { padding-right: 24px; }" });
          const tight = await header.evaluate((h) => h.getBoundingClientRect().height);
          await spare.evaluate((s) => (s as Element).remove());
          expect(tight, `one row at 1280 ${locale} with 24px to spare`).toBeLessThan(80);
        }
        const style = await page.addStyleTag({
          content:
            '[data-docket-grade] { display: none !important; } a[href="/profile"] > span { max-width: none !important; }',
        });
        const today = await header.evaluate((h) => h.getBoundingClientRect().height);
        await style.evaluate((s) => (s as Element).remove());
        expect(fit.height, `header height at ${width} ${locale}`).toBeLessThanOrEqual(today);
      }
  });
});
