import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { Client } from "pg";
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

// #967 C4, C6, C7: `Ta place au Ministère`, the typist census section (ADR 0023). On /profile it needs
// 30 typists with 3 counted results each; the e2e database holds far fewer, so a viewer with 3 races sees
// no section and no placeholder (C6). The drawing and the switches are checked on the /design specimen,
// which draws the census fixtures of #966 (C4, C7).

/** Typists with at least 3 counted results (the `countedPopulationWhere` rule of #966), as SQL. */
async function censusPopulation(): Promise<number> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM (
         SELECT r."userId" FROM "RaceResult" r JOIN "Race" race ON race.id = r."raceId"
         WHERE r."userId" IS NOT NULL AND r."isBot" = false AND r.suspicious = false
           AND r.status IN ('FINISHED', 'TIMED_OUT') AND race."endReason" IN ('ALL_FINISHED', 'TIMER')
         GROUP BY r."userId" HAVING count(*) >= 3) t`,
    );
    return Number(rows[0]!.n);
  } finally {
    await db.end();
  }
}

const census = (page: Page) => page.locator('[data-section="census"]');

test.describe("typist census (#967)", () => {
  test.setTimeout(scaled(120_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("C6 a viewer with 3 races in a small population sees no census section", async ({
    page,
    request,
  }) => {
    await threeRaces(request, await seedLobby(page));
    const population = await censusPopulation();
    test.skip(population >= 30, `the shared e2e database holds ${population} typists`);
    await openFile(page);
    await expect(figure(page, "races")).toHaveText("3");
    await expect(page.locator("[data-section='streaks']")).toBeVisible();
    await expect(census(page)).toHaveCount(0);
    await expect(page.getByText("Your place at the Ministry")).toHaveCount(0);
  });

  test("C4 C7 /design: tabs and toggle redraw the census with no request, axe-clean, no sideways scroll", async ({
    page,
  }) => {
    await page.goto("/design#profile");
    const section = page.locator('section[aria-labelledby="profile-two-weeks-guest-census"]');
    await expect(section).toBeVisible({ timeout: HYDRATION_WAIT });
    const sentence = section.locator("[data-census-sentence]");
    const plot = section.locator("[data-census-plot]");
    const marker = section.locator("[data-census-marker]");
    const ticks = section.locator("[data-census-ticks]");
    await expect(sentence).toHaveText(
      /^Your average speed beats that of \d+\.\d\s% of the Ministry's comrades\.$/,
    );
    await expect(plot).toHaveAttribute("aria-label", /You: 54\.2\sWPM\.$/);
    await expect(ticks).toContainText("150 WPM");

    const speed = section.getByRole("button", { name: "SPEED" });
    const accuracy = section.getByRole("button", { name: "ACCURACY" });
    const best = section.getByRole("button", { name: "BEST" });
    await expect(speed).toHaveAttribute("aria-pressed", "true");
    // hydrated: a press flips the state (retried until the client leaf answers)
    await expect(async () => {
      await accuracy.click();
      await expect(accuracy).toHaveAttribute("aria-pressed", "true", { timeout: scaled(500) });
    }).toPass({ timeout: HYDRATION_WAIT });
    // back to speed, then everything after this point must happen with no request
    await speed.click();
    await expect(speed).toHaveAttribute("aria-pressed", "true");
    const left = await marker.getAttribute("style");
    await page.waitForLoadState("networkidle");
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await accuracy.click();
    await expect(sentence).toContainText("Your average accuracy beats");
    await expect(ticks).toContainText("80 %");
    await best.click();
    await expect(best).toHaveAttribute("aria-pressed", "true");
    await expect(sentence).toContainText("Your best accuracy beats");
    await expect(plot).toHaveAttribute("aria-label", /You: 96\.1\s%\.$/);
    expect(await marker.getAttribute("style")).not.toBe(left);
    await speed.focus();
    await page.keyboard.press("Enter");
    await expect(sentence).toContainText("Your best speed beats");
    await expect(ticks).toContainText("150 WPM");
    expect(requests, "requests while switching").toEqual([]);

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const { violations } = await new AxeBuilder({ page })
        .include('section[aria-labelledby="profile-two-weeks-guest-census"]')
        .include('section[aria-labelledby="profile-two-weeks-account-census"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        bad.map((v) => v.id),
        `axe ${scheme}`,
      ).toEqual([]);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "sideways scroll").toBe(false);
  });
});

// Contract of #330 (C7, C8): the attendance register ("Registre de présence", bible 14.3). A guest with
// counted races on three known days (today, yesterday, three days ago; results backdated in the
// database after the signed routes stored them) reads a 2-day current streak and 3 active days over
// the window from the first day of the month two months back to today; a second browser context sees
// none of it. At 375 the three months stack. The section is axe-clean at 375 / 768 / 1280 in both
// themes and never scrolls the page sideways; `/design#profile` shows it for the two-week fixture.

const attendance = (page: Page) => page.locator('[data-section="attendance"]');

/** Today's `YYYY-MM-DD` in the stats time zone and the register's window length in days. */
function torontoWindow(): { today: string; windowDays: number } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const first = Date.UTC(y, m - 3, 1);
  return { today, windowDays: (Date.UTC(y, m - 1, d) - first) / 86_400_000 + 1 };
}

/** One counted race per entry of `daysAgo`, then its result moved back that many days. */
async function racesOnDays(
  request: Parameters<typeof startRace>[0],
  lobby: Awaited<ReturnType<typeof seedLobby>>,
  daysAgo: number[],
) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    for (const days of daysAgo) {
      const desks: Desk[] = [
        { desk: 1, name: "Host", place: 1, wpm: 45, accuracy: 0.95, userId: lobby.hostUserId },
        { desk: 2, name: "Typist Bot", place: 2, wpm: 40, isBot: true },
      ];
      const raceId = await startRace(request, lobby, desks);
      await postResults(request, raceId, desks);
      const at = new Date(Date.now() - days * 86_400_000).toISOString();
      await db.query(
        `UPDATE "RaceResult" SET "createdAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE "raceId" = $2`,
        [at, raceId],
      );
    }
  } finally {
    await db.end();
  }
}

test.describe("attendance register (#330)", () => {
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("C7 three known days: streak and active days, today ringed; stacked at 375; another browser sees none", async ({
    page,
    request,
    browser,
    context,
  }) => {
    await racesOnDays(request, await seedLobby(page), [0, 1, 3]);
    const { today, windowDays } = torontoWindow();
    await openFile(page);
    const section = attendance(page);
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading", { name: "Attendance register" })).toBeVisible();
    await expect(section.locator('[data-attendance="current"] dd')).toHaveText("2 DAYS");
    await expect(section.locator('[data-attendance="best"] dd')).toHaveText("2 DAYS");
    await expect(section.locator('[data-attendance="active"] dd')).toHaveText(`3 / ${windowDays}`);
    const cell = section.locator(`[data-day="${today}"]`);
    await expect(cell).toHaveAttribute("data-today", "");
    await expect(cell).toHaveAttribute("data-level", "1");
    await expect(cell).toContainText(/\(today\): 0 min, 5 % of the goal$/);
    await expect(section.getByRole("table")).toHaveCount(3);
    await expect(section).toContainText("DAILY GOAL (15 MIN)");
    // the section sits before the race archives
    const order = await page
      .locator("[data-section]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    expect(order.indexOf("attendance")).toBe(order.indexOf("archive") - 1);

    // French
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await openFile(page);
    await expect(attendance(page).locator('[data-attendance="current"] dt')).toHaveText(
      "SÉRIE ACTUELLE",
    );
    await expect(attendance(page).locator('[data-attendance="current"] dd')).toHaveText("2 JOURS");
    await expect(attendance(page)).toContainText("OBJECTIF QUOTIDIEN (15 MIN)");

    // at 375 the months stack: one column
    await page.setViewportSize({ width: 375, height: 800 });
    const lefts = await attendance(page)
      .locator("table")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);

    const other = await browser.newContext();
    try {
      await other.addCookies([{ name: "locale", value: "en", url }]);
      const stranger = await other.newPage();
      await withoutWebGL(stranger);
      await seedLobby(stranger);
      await openFile(stranger);
      await expect(blank(stranger)).toBeVisible();
      await expect(attendance(stranger)).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  test("C8 axe-clean at 375, 768 and 1280 in both themes; no sideways scroll at 375", async ({
    page,
    request,
  }) => {
    await racesOnDays(request, await seedLobby(page), [0, 1, 2]);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openFile(page);
        await expect(attendance(page)).toBeVisible();
        const { violations } = await new AxeBuilder({ page })
          .include('[data-section="attendance"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(
          bad.map((v) => v.id),
          `axe ${scheme} ${width}`,
        ).toEqual([]);
        if (width === 375) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          expect(overflow, "sideways scroll").toBe(false);
        }
      }
    }
  });

  test("#968 C4 a goal of 30 filed on /settings: the legend reads 30 MIN, a 15-minute day drops to 50 %", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await racesOnDays(request, lobby, [0]);
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query(`UPDATE "RaceResult" SET "durationMs" = 900000 WHERE "userId" = $1`, [
        lobby.hostUserId,
      ]);
    } finally {
      await db.end();
    }
    const { today } = torontoWindow();
    await openFile(page);
    await expect(attendance(page)).toContainText("DAILY GOAL (15 MIN)");
    await expect(attendance(page).locator(`[data-day="${today}"]`)).toHaveAttribute(
      "data-level",
      "4",
    );

    await page.goto("/settings");
    const slider = page.getByRole("slider", { name: "DAILY GOAL" });
    await expect(slider).toHaveAttribute("data-hydrated", "", { timeout: HYDRATION_WAIT });
    await slider.fill("30");
    await expect(page.locator('[data-setting="dailyGoalMin"]').getByRole("status")).toHaveText(
      "FILED",
    );

    await openFile(page);
    await expect(attendance(page)).toContainText("DAILY GOAL (30 MIN)");
    const cell = attendance(page).locator(`[data-day="${today}"]`);
    await expect(cell).toHaveAttribute("data-level", "2");
    await expect(cell).toContainText(/\(today\): 15 min, 50 % of the goal$/);
  });

  test("C8 /design#profile shows the register for the two-week fixture", async ({ page }) => {
    await page.goto("/design#profile");
    const section = page.locator(
      'section[aria-labelledby="profile-two-weeks-guest-attendance"][data-section="attendance"]',
    );
    await expect(section).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(section.locator('[data-attendance="best"] dd')).toHaveText("9 DAYS");
    await expect(section.locator('[data-attendance="active"] dd')).toHaveText("13 / 74");
    await expect(section.locator("[data-today]")).toHaveCount(1);
  });
});

// Contract of #962 (C5, C6): the progress by key ("Progression par touche", bible 14.3). A guest with
// three counted races and key rows on three days (CharStatDaily rows written straight into the test
// database, as the rollup job of #314 would) sees the grid after the clean streaks and before the
// output curve: `DAY 1 → 3`, E's sentence, K never met. Three races without key rows show no section.
// At 375 the grid scrolls inside its own focusable region, never the page; axe-clean at 375 / 768 /
// 1280 in both themes; `/design#profile` shows it for the two-week fixture.

const keyProgress = (page: Page) => page.locator('[data-section="key-progress"]');

/** Key rows for `userId`: on each of the 3 latest days, `e` at 30, 36 then 42 WPM, `a` at 40. */
async function keyRows(userId: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    for (const [i, wpm] of [30, 36, 42].entries()) {
      const day = new Date(Date.now() - (2 - i) * 86_400_000).toISOString().slice(0, 10);
      for (const [char, speed] of [
        ["e", wpm],
        ["a", 40],
      ] as const) {
        await db.query(
          `INSERT INTO "CharStatDaily" ("userId", day, char, layout, hits, errors, "timedHits", "totalMs")
           VALUES ($1, $2::date, $3, 'FR_CA', 11, 0, 10, $4)`,
          [userId, day, char, Math.round(120_000 / speed)],
        );
      }
    }
  } finally {
    await db.end();
  }
}

test.describe("progress by key (#962)", () => {
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("C5 three races and three days of keys: the grid between streaks and curve; absent without keys", async ({
    page,
    request,
    context,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await openFile(page);
    // three races, no key data yet: no section, no placeholder
    await expect(curve(page)).toBeVisible();
    await expect(keyProgress(page)).toHaveCount(0);

    await keyRows(lobby.hostUserId);
    await openFile(page);
    const section = keyProgress(page);
    await expect(section.getByRole("heading", { name: "Progress by key" })).toBeVisible();
    await expect(section).toContainText("LEARNING REPORT");
    await expect(section.locator("[data-key-days]")).toHaveText("DAY 1 → 3");
    await expect(section.getByRole("rowheader")).toHaveCount(30);
    const e = section.locator('tr[data-key="e"]');
    await expect(e).toContainText("E: average 35.3 WPM, from 30.0 to 42.0 over 3 days");
    await expect(e.locator('[style*="background"]')).toHaveCount(3);
    await expect(section.locator('tr[data-key="k"]')).toContainText("K: never met");
    await expect(section.locator('tr[data-key="k"] td').last()).toHaveText("—");
    await expect(section.locator("[data-key-legend]")).toHaveText(/SLOW\s*FAST/);
    const order = await page
      .locator("[data-section]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
    expect(order.indexOf("key-progress")).toBe(order.indexOf("curve") - 1);
    expect(order.indexOf("key-progress")).toBeGreaterThan(order.indexOf("streaks"));

    // French
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await openFile(page);
    await expect(keyProgress(page).locator("[data-key-days]")).toHaveText("JOUR 1 → 3");
    await expect(keyProgress(page).locator('tr[data-key="e"]')).toContainText(
      "E : moyenne 35,3 MPM, de 30,0 à 42,0 sur 3 jours",
    );

    // at 375 the grid scrolls inside its own focusable, labelled region, never the page
    await page.setViewportSize({ width: 375, height: 800 });
    const region = page.getByRole("region", {
      name: "Progression par touche, défilement horizontal",
    });
    await expect(region).toHaveAttribute("tabindex", "0");
    const sizes = await region.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "sideways scroll").toBe(false);
  });

  test("C6 axe-clean at 375, 768 and 1280 in both themes; no sideways scroll at 375", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await keyRows(lobby.hostUserId);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openFile(page);
        await expect(keyProgress(page)).toBeVisible();
        const { violations } = await new AxeBuilder({ page })
          .include('[data-section="key-progress"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(
          bad.map((v) => v.id),
          `axe ${scheme} ${width}`,
        ).toEqual([]);
        if (width === 375) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          expect(overflow, "sideways scroll").toBe(false);
        }
      }
    }
  });

  test("C6 /design#profile shows the grid for the two-week fixture", async ({ page }) => {
    await page.goto("/design#profile");
    const section = page.locator(
      'section[aria-labelledby="profile-two-weeks-guest-key-progress"][data-section="key-progress"]',
    );
    await expect(section).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(section.locator("[data-key-days]")).toHaveText("DAY 1 → 14");
    await expect(section.getByRole("rowheader")).toHaveCount(30);
    await expect(page.locator('[data-section="key-progress"]')).toHaveCount(2);
  });
});

// Contract of #963 (C5, C6, C7): the key sheet ("Fiche par touche", bible 14.3). A guest with three
// counted races and key rows on three days (written straight into CharStatDaily, as the rollup of #314
// would) sees the sheet after the output curve and before the attendance register, E (the most typed)
// selected. Picking Ç (needs work) redraws its cells, plot sentence and legend with no request and no
// layout shift, announced politely; without JavaScript E's sheet still reads. Axe-clean at 375 / 768 /
// 1280 in both themes, no sideways scroll at 375; `/design#profile` shows it for the two-week fixture.

const keySheet = (page: Page) => page.locator('[data-section="key-sheet"]');
const keyStat = (page: Page, id: string) => keySheet(page).locator(`[data-key-stat="${id}"] dd`);

/** Key rows for `userId` on the 3 latest days: `e` at 30, 36, 42 (most typed), `a` at 40, `ç` at 20. */
async function keySheetRows(userId: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    for (const [i, wpm] of [30, 36, 42].entries()) {
      const day = new Date(Date.now() - (2 - i) * 86_400_000).toISOString().slice(0, 10);
      for (const [char, speed, hits, errors] of [
        ["e", wpm, 20, 1],
        ["a", 40, 11, 0],
        ["ç", 20, 10, 2],
      ] as const) {
        await db.query(
          `INSERT INTO "CharStatDaily" ("userId", day, char, layout, hits, errors, "timedHits", "totalMs")
           VALUES ($1, $2::date, $3, 'FR_CA', $4, $5, 10, $6)`,
          [userId, day, char, hits, errors, Math.round(120_000 / speed)],
        );
      }
    }
  } finally {
    await db.end();
  }
}

test.describe("key sheet (#963)", () => {
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("C5 C6 after the curve; picking a weak key redraws it with no request and no layout shift; reads without JS", async ({
    page,
    request,
    browser,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await openFile(page);
    await expect(curve(page)).toBeVisible();
    await expect(keySheet(page)).toHaveCount(0);

    await keySheetRows(lobby.hostUserId);
    await openFile(page);
    const section = keySheet(page);
    await expect(section.getByRole("heading", { name: "Key sheet" })).toBeVisible();
    await expect(section).toContainText("INDIVIDUAL QUESTIONING");
    const order = await page
      .locator("[data-section]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
    expect(order.indexOf("key-sheet")).toBe(order.indexOf("curve") + 1);
    expect(order.indexOf("key-sheet")).toBeLessThan(order.indexOf("attendance"));

    const chips = section.getByRole("group", { name: "Keys" }).getByRole("button");
    await expect(chips).toHaveCount(30);
    const e = section.getByRole("button", { name: "E, goal reached" });
    const c = section.getByRole("button", { name: "Ç, needs work" });
    await expect(e).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByRole("button", { name: "K, never met" })).toBeDisabled();
    await expect(keyStat(page, "latest")).toHaveText("42.0 WPM");
    await expect(keyStat(page, "rate")).toHaveText("UNCERTAIN");

    await page.waitForLoadState("networkidle");
    const layout = () =>
      section.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [r.top + window.scrollY, r.height, r.width];
      });
    const box = await layout();
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await expect(async () => {
      await c.click();
      await expect(c).toHaveAttribute("aria-pressed", "true", { timeout: scaled(1000) });
    }).toPass({ timeout: HYDRATION_WAIT });
    await expect(e).toHaveAttribute("aria-pressed", "false");
    await expect(keyStat(page, "latest")).toHaveText("20.0 WPM");
    await expect(keyStat(page, "best")).toHaveText("20.0 WPM");
    await expect(keyStat(page, "average")).toHaveText("20.0 WPM");
    await expect(keyStat(page, "errors")).toHaveText("20.0 %");
    await expect(section.getByRole("img")).toHaveAccessibleName(
      "Key Ç: from 20.0 to 20.0 WPM over 3 days, 35 WPM goal not reached yet.",
    );
    await expect(section.locator("[data-key-legend]")).toContainText("speed on key Ç");
    await expect(section.locator('[aria-live="polite"]')).toHaveText(
      "Key Ç: from 20.0 to 20.0 WPM over 3 days, 35 WPM goal not reached yet.",
    );
    expect(requests, "no request during the pick").toEqual([]);
    expect(await layout(), "no layout shift").toEqual(box);

    // without JavaScript the sheet of the most typed key still reads
    const state = await page.context().storageState();
    const noJs = await browser.newContext({
      javaScriptEnabled: false,
      storageState: state,
      viewport: { width: 1280, height: 900 },
    });
    const still = await noJs.newPage();
    await still.goto("/profile");
    await expect(keySheet(still).getByRole("button", { name: "E, goal reached" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(keyStat(still, "latest")).toHaveText("42.0 WPM");
    await noJs.close();
  });

  test("C7 axe-clean at 375, 768 and 1280 in both themes; no sideways scroll at 375", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await keySheetRows(lobby.hostUserId);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openFile(page);
        await expect(keySheet(page)).toBeVisible();
        const { violations } = await new AxeBuilder({ page })
          .include('[data-section="key-sheet"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(
          bad.map((v) => v.id),
          `axe ${scheme} ${width}`,
        ).toEqual([]);
        if (width === 375) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          expect(overflow, "sideways scroll").toBe(false);
        }
      }
    }
  });

  test("C7 /design#profile shows the sheet for the two-week fixture", async ({ page }) => {
    await page.goto("/design#profile");
    const section = page.locator(
      'section[aria-labelledby="profile-two-weeks-guest-key-sheet"][data-section="key-sheet"]',
    );
    await expect(section).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(section.getByRole("button", { name: "E, goal reached" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(section.getByRole("button", { name: "Q, needs work" })).toBeVisible();
    await expect(page.locator('[data-section="key-sheet"]')).toHaveCount(2);
  });
});

// Contract of #964 (C4, C5): the key inventory ("Vitesse, frappes et fautes", bible 14.3). With three
// counted races and the key sheet's rows (`keySheetRows`) a guest sees it right after the key sheet and
// before the attendance register: four rows of 30 bars, E over the goal, Ç under it, K bare; the same
// figures in a hidden table. At 375 the bars keep their 30 columns and scroll inside their own labelled
// region, never the page. Axe-clean at 375 / 768 / 1280 in both themes; `/design#profile` shows it.

const keyInventory = (page: Page) => page.locator('[data-section="key-inventory"]');

test.describe("key inventory (#964)", () => {
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("C4 after the key sheet; four rows of 30 bars, the table; absent without keys; scrolls in its region at 375", async ({
    page,
    request,
    context,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await openFile(page);
    await expect(curve(page)).toBeVisible();
    await expect(keyInventory(page)).toHaveCount(0);

    await keySheetRows(lobby.hostUserId);
    await openFile(page);
    const section = keyInventory(page);
    await expect(section.getByRole("heading", { name: "Speed, strokes and errors" })).toBeVisible();
    await expect(section).toContainText("KEY INVENTORY");
    const order = await page
      .locator("[data-section]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
    expect(order.indexOf("key-inventory")).toBe(order.indexOf("key-sheet") + 1);
    expect(order.indexOf("key-inventory")).toBeLessThan(order.indexOf("attendance"));

    for (const id of ["speed", "strokes", "errors", "ratio"]) {
      await expect(section.locator(`[data-inventory-row="${id}"] [data-bar]`)).toHaveCount(30);
    }
    const speed = section.locator('[data-inventory-row="speed"]');
    await expect(speed.locator('[data-bar="e"]')).toHaveAttribute("data-bar-look", "good");
    await expect(speed.locator('[data-bar="ç"]')).toHaveAttribute("data-bar-look", "weak");
    await expect(speed.locator('[data-bar="k"]')).toHaveAttribute("data-bar-look", "none");
    await expect(speed.locator("[data-inventory-goal]")).toHaveCount(1);
    // e is the most struck key: the tallest strokes bar fills the row
    const strokes = section.locator('[data-inventory-row="strokes"]');
    await expect(strokes.locator('[data-bar="e"]')).toHaveAttribute("style", /height:\s*100%/);

    const table = section.getByRole("table", { name: "Speed, strokes and errors by key" });
    await expect(table.getByRole("row")).toHaveCount(31);
    const cells = (char: string) => table.locator(`tr[data-key="${char}"]`).locator("th, td");
    await expect(cells("e")).toHaveText([
      "E",
      "35.3\u00a0WPM, goal reached",
      "60",
      "3",
      "5.0\u00a0%",
    ]);
    await expect(cells("ç")).toHaveText([
      "Ç",
      "20.0\u00a0WPM, under the goal",
      "30",
      "6",
      "20.0\u00a0%",
    ]);

    // French, and at 375 the rows scroll inside their own focusable, labelled region, never the page
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await openFile(page);
    await expect(keyInventory(page)).toContainText("INVENTAIRE DES TOUCHES");
    const region = page.getByRole("region", {
      name: "Vitesse, frappes et fautes, défilement horizontal",
    });
    await expect(region).toHaveAttribute("tabindex", "0");
    const sizes = await region.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    await expect(region.locator('[data-inventory-row="speed"] [data-bar]')).toHaveCount(30);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "sideways scroll").toBe(false);
  });

  test("C5 axe-clean at 375, 768 and 1280 in both themes; no sideways scroll at 375", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await keySheetRows(lobby.hostUserId);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openFile(page);
        await expect(keyInventory(page)).toBeVisible();
        const { violations } = await new AxeBuilder({ page })
          .include('[data-section="key-inventory"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(
          bad.map((v) => v.id),
          `axe ${scheme} ${width}`,
        ).toEqual([]);
        if (width === 375) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          expect(overflow, "sideways scroll").toBe(false);
        }
      }
    }
  });

  test("C5 /design#profile shows the inventory for the two-week fixture", async ({ page }) => {
    await page.goto("/design#profile");
    const section = page.locator(
      'section[aria-labelledby="profile-two-weeks-guest-key-inventory"][data-section="key-inventory"]',
    );
    await expect(section).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(section.locator('[data-inventory-row="speed"] [data-bar]')).toHaveCount(30);
    await expect(section.locator('[data-inventory-row="speed"] [data-bar="q"]')).toHaveAttribute(
      "data-bar-look",
      "weak",
    );
    await expect(page.locator('[data-section="key-inventory"]')).toHaveCount(2);
  });
});

// Contract of #965 (C4, C5): the suspect letter pairs ("Combinaisons suspectes", bible 14.3). With three
// counted races and key rows a guest without letter-pair rows sees the streak docket alone across the
// row; with pair rows (`BigramStatDaily`, written straight into the test database as the rollup job of
// #314 would) the docket sits in the grid's second cell, one row per pair weakest first, each read as a
// sentence. Axe-clean at 375 / 768 / 1280 in both themes, no sideways scroll at 375; `/design#profile`
// shows it for the two-week fixture.

const suspectPairs = (page: Page) => page.locator('[data-section="suspect-pairs"]');

/** Today's key rows for `userId` (`e` at 40 WPM) and three letter pairs: `on` 6.4 %, `qu` 4 %, `es` 0. */
async function pairRows(userId: string, { pairs = true } = {}) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO "CharStatDaily" ("userId", day, char, layout, hits, errors, "timedHits", "totalMs")
       VALUES ($1, $2::date, 'e', 'FR_CA', 11, 0, 10, 3000) ON CONFLICT DO NOTHING`,
      [userId, day],
    );
    if (!pairs) return;
    for (const [pair, hits, errors, wpm] of [
      ["on", 125, 8, 31],
      ["qu", 50, 2, 27],
      ["es", 40, 0, 52],
    ] as const) {
      await db.query(
        `INSERT INTO "BigramStatDaily" ("userId", day, pair, hits, errors, "timedHits", "totalMs")
         VALUES ($1, $2::date, $3, $4, $5, $4, $6)`,
        [userId, day, pair, hits, errors, Math.round((12_000 * hits) / wpm)],
      );
    }
  } finally {
    await db.end();
  }
}

test.describe("suspect letter pairs (#965)", () => {
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("C4 without pair data the streak docket spans the row; with pairs the docket sits beside it", async ({
    page,
    request,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await pairRows(lobby.hostUserId, { pairs: false });
    await openFile(page);
    const streaks = page.locator('[data-section="streaks"]');
    await expect(streaks).toBeVisible();
    await expect(suspectPairs(page)).toHaveCount(0);
    const grid = page.locator("[data-docket-pair]");
    const across = async () =>
      ((await streaks.boundingBox())!.width / (await grid.boundingBox())!.width) * 100;
    expect(await across()).toBeGreaterThan(99);

    await pairRows(lobby.hostUserId);
    await openFile(page);
    const docket = suspectPairs(page);
    await expect(docket.getByRole("heading", { name: "SUSPECT COMBINATIONS" })).toBeVisible();
    await expect(docket).toContainText("UNDER WATCH");
    // the grid's second cell: beside the streak docket, on the same row
    const a = (await streaks.boundingBox())!;
    const b = (await docket.boundingBox())!;
    expect(b.x).toBeGreaterThan(a.x + a.width);
    expect(Math.abs(b.y - a.y)).toBeLessThan(2);
    const list = docket.getByRole("list", { name: "SUSPECT COMBINATIONS" });
    await expect(list.getByRole("listitem")).toHaveText([
      /ON: 6\.4\s%\serrors, 31\sWPM/,
      /QU: 4\.0\s%\serrors, 27\sWPM/,
      /ES: 0\.0\s%\serrors, 52\sWPM/,
    ]);
    await expect(docket.locator('[data-pair="on"] [data-pair-bar]')).toHaveAttribute(
      "style",
      /width:\s*100%/,
    );
    await expect(docket.locator('[data-pair="es"] [data-pair-bar]')).toHaveAttribute(
      "style",
      /width:\s*0%/,
    );

    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await openFile(page);
    await expect(
      suspectPairs(page).getByRole("heading", { name: "COMBINAISONS SUSPECTES" }),
    ).toBeVisible();
    await expect(suspectPairs(page).getByRole("listitem").first()).toHaveText(
      /ON : 6,4\s%\sde fautes, 31\sMPM/,
    );
  });

  test("C5 axe-clean at 375, 768 and 1280 in both themes; no sideways scroll at 375", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await pairRows(lobby.hostUserId);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openFile(page);
        await expect(suspectPairs(page)).toBeVisible();
        const { violations } = await new AxeBuilder({ page })
          .include('[data-section="suspect-pairs"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(
          bad.map((v) => v.id),
          `axe ${scheme} ${width}`,
        ).toEqual([]);
        if (width === 375) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          expect(overflow, "sideways scroll").toBe(false);
        }
      }
    }
  });

  test("C5 /design#profile shows the docket for the two-week fixture", async ({ page }) => {
    await page.goto("/design#profile");
    const section = page.locator(
      'section[aria-labelledby="profile-two-weeks-guest-suspect-pairs"][data-section="suspect-pairs"]',
    );
    await expect(section).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(section.getByRole("listitem")).toHaveCount(6);
    await expect(section.locator("[data-pair]").first()).toHaveAttribute("data-pair", "qu");
    await expect(page.locator('[data-section="suspect-pairs"]')).toHaveCount(2);
  });
});

// Contract of #324 (C6, C7, C8): the keyboard map ("Carte du clavier", bible 14.3). With three counted
// races and the key sheet's rows a guest (no saved layout) sees it right after the key inventory and
// before the attendance register, on the locale's default layout (English: US QWERTY); switching to
// AZERTY from the keyboard redraws it with no request. At 375 the board keeps its proportions inside the
// column. Axe-clean at 375 / 768 / 1280 in both themes; `/design#profile` shows it.

const keyboardMap = (page: Page) => page.locator('[data-section="keyboard-map"]');

test.describe("keyboard map (#324)", () => {
  test.setTimeout(scaled(150_000));

  test.beforeEach(async ({ context, page }) => {
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "en", url }]);
    await withoutWebGL(page);
  });

  test("C6 C7 after the inventory on the locale's layout; AZERTY from the keyboard, no request; 375 keeps proportions", async ({
    page,
    request,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await openFile(page);
    await expect(curve(page)).toBeVisible();
    await expect(keyboardMap(page)).toHaveCount(0);

    await keySheetRows(lobby.hostUserId);
    await openFile(page);
    const section = keyboardMap(page);
    await expect(section.getByRole("heading", { name: "Keyboard map" })).toBeVisible();
    await expect(section.locator("[data-keyboard-kicker]")).toHaveText("MACHINE PLAN · US QWERTY");
    const order = await page
      .locator("[data-section]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
    expect(order.indexOf("keyboard-map")).toBe(order.indexOf("key-inventory") + 1);
    expect(order.indexOf("keyboard-map")).toBe(order.indexOf("attendance") - 1);

    const layouts = section.getByRole("group", { name: "Keyboard layout" });
    await expect(layouts.getByRole("button")).toHaveCount(4);
    await expect(layouts.getByRole("button", { name: "US QWERTY" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // e: 60 of the 93 strokes on US QWERTY keys (ç is not one), 3 errors; k never struck
    const board = section.getByRole("group", { name: "Keyboard map, US QWERTY" });
    await expect(
      board.getByRole("img", { name: "E: 64.5 % of strokes, 5.0 % errors" }),
    ).toBeVisible();
    await expect(board.getByRole("img", { name: "K: never struck" })).toBeVisible();
    await expect(section.locator('[data-row-share="top"] dd')).toHaveText("65 %");
    const firstTop = section.locator('[data-keyboard-row="top"] [data-key-cap]').first();
    await expect(firstTop).toHaveText("Q");

    // AZERTY from the keyboard: no request, the board redraws from the page's props
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    const azerty = layouts.getByRole("button", { name: "AZERTY" });
    await azerty.focus();
    await page.keyboard.press("Enter");
    await expect(azerty).toHaveAttribute("aria-pressed", "true");
    await expect(firstTop).toHaveText("A");
    await expect(section.locator("[data-keyboard-kicker]")).toHaveText("MACHINE PLAN · AZERTY");
    await expect(section.getByRole("group", { name: "Keyboard map, AZERTY" })).toBeVisible();
    expect(requests).toEqual([]);

    // French at 375: CSA first; the board stays inside the column, keys square fractions of its width
    const url = test.info().project.use.baseURL!;
    await context.addCookies([{ name: "locale", value: "fr", url }]);
    await page.setViewportSize({ width: 375, height: 800 });
    await openFile(page);
    await expect(keyboardMap(page).locator("[data-keyboard-kicker]")).toHaveText(
      "PLAN DE LA MACHINE · FRANÇAIS CANADIEN (CSA)",
    );
    const boardBox = (await keyboardMap(page).locator("[data-keyboard-board]").boundingBox())!;
    expect(boardBox.x).toBeGreaterThanOrEqual(0);
    expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(375);
    const key = (await keyboardMap(page).locator('[data-key="e"]').boundingBox())!;
    expect(Math.abs(key.width - key.height)).toBeLessThan(1);
    expect(key.width).toBeLessThan(boardBox.width / 13);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, "sideways scroll").toBe(false);
  });

  test("C8 axe-clean at 375, 768 and 1280 in both themes; no sideways scroll at 375", async ({
    page,
    request,
  }) => {
    const lobby = await seedLobby(page);
    await threeRaces(request, lobby);
    await keySheetRows(lobby.hostUserId);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await openFile(page);
        await expect(keyboardMap(page)).toBeVisible();
        const { violations } = await new AxeBuilder({ page })
          .include('[data-section="keyboard-map"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(
          bad.map((v) => v.id),
          `axe ${scheme} ${width}`,
        ).toEqual([]);
        if (width === 375) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          expect(overflow, "sideways scroll").toBe(false);
        }
      }
    }
  });

  test("C8 /design#profile shows the map for the two-week fixture", async ({ page }) => {
    await page.goto("/design#profile");
    const section = page.locator(
      'section[aria-labelledby="profile-two-weeks-guest-keyboard-map"][data-section="keyboard-map"]',
    );
    await expect(section).toBeVisible({ timeout: HYDRATION_WAIT });
    await expect(section.locator("[data-keyboard-row]")).toHaveCount(4);
    await expect(section.locator('[data-key="e"] [data-key-circle]')).toHaveAttribute(
      "style",
      /width:\s*140%/,
    );
    await expect(page.locator('[data-section="keyboard-map"]')).toHaveCount(2);
  });
});
