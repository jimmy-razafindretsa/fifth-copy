import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
  openRace,
} from "../race/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";
import { normalizeTypeable, type Keystroke } from "@fifth-copy/engine";
import { deskIdentity } from "@fifth-copy/protocol";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createLobby } from "../race/helpers";
import {
  postResults,
  raceTextOf,
  seedLobby,
  six,
  startRace,
  withoutWebGL,
  type Desk,
} from "./helpers";

// Contract of #864 C3: the personal stats card in the Dawn report's `personal` slot (bible 14.4), from
// races seeded through the signed internal routes (helpers.ts) on the page's own lobby (its host is the
// viewer). A typist's card shows the place, WPM and accuracy of their ranking row and their bonuses by
// name; a spectator (a viewer with no desk) has no card and the ranking takes the full width. Every
// project runs it: 375 and 768 stack the slots, 1280 puts the card beside the ranking.

const card = (page: Page) => page.locator('[data-slot="personal"] [data-personal]');
const ranking = (page: Page) => page.locator("[data-ranking]");

/** A finished race of these desks on the page's own lobby. */
async function report(
  page: Page,
  request: Parameters<typeof startRace>[0],
  desks: (h: string) => Desk[],
) {
  // the podium's clerk frames are not under test: their stamp fallback keeps software GL out of the way
  await withoutWebGL(page);
  const lobby = await seedLobby(page);
  const seeded = desks(lobby.hostUserId);
  const raceId = await startRace(request, lobby, seeded);
  await postResults(request, raceId, seeded);
  await page.goto(`/results/${raceId}`);
  await expect(ranking(page)).toBeVisible({ timeout: HYDRATION_WAIT });
}

/** Six desks; the viewer is desk 12 (third), who sent two cards and was hit by one. */
const withBonuses = (host: string): Desk[] =>
  six(host).map((d) => {
    if (d.desk === 7) return { ...d, userId: null };
    if (d.desk !== 12) return d;
    return {
      ...d,
      userId: host,
      accuracy: 0.91,
      bonusLog: [
        { t: 9_000, kind: "extra-paperwork", from: 12, to: 7 },
        { t: 21_000, kind: "smoke-break", from: 12, to: 7 },
        { t: 21_000, kind: "smoke-break", from: 12, to: 3 },
        { t: 30_000, kind: "extra-paperwork", from: 4, to: 12 },
      ],
    };
  });

test.describe("Dawn report personal card (#864)", () => {
  test.setTimeout(scaled(90_000));

  test("C3 a typist's card: the place, WPM and accuracy of their ranking row; bonuses by name", async ({
    page,
    request,
  }, info) => {
    await report(page, request, withBonuses);
    await expect(card(page)).toHaveCount(1);
    await expect(page.getByRole("region", { name: "FORM 5-R · YOUR COPY" })).toBeVisible();

    const mine = ranking(page).locator('tbody tr[data-you="true"]');
    await expect(mine).toHaveAttribute("data-desk", "12");
    const place = Number(await mine.getAttribute("data-place"));
    const wpm = await mine.locator('[data-col="wpm"]').textContent();
    const accuracy = await mine.locator('[data-col="accuracy"]').textContent();
    await expect(card(page).locator('[data-field="place"]')).toHaveText(`№ ${place}`);
    await expect(card(page).locator('[data-field="wpm"]')).toHaveText(wpm!);
    await expect(card(page).locator('[data-field="accuracy"]')).toHaveText(accuracy!);
    expect(place).toBe(3);
    expect(wpm).toBe("48");
    expect(accuracy).toBe("91 %");
    await expect(card(page).locator('[data-field="status"]')).toHaveCount(0);

    const sent = card(page).locator('[data-row="sent"]');
    const received = card(page).locator('[data-row="received"]');
    await expect(sent.locator("li")).toHaveText(["EXTRA PAPERWORK × 1", "SMOKE BREAK × 1"]);
    await expect(received.locator("li")).toHaveText(["EXTRA PAPERWORK × 1"]);

    // beside the ranking from 1024px, stacked under it below (bible 14.4)
    await card(page).scrollIntoViewIfNeeded();
    const cardBox = (await card(page).boundingBox())!;
    const rankBox = (await ranking(page).boundingBox())!;
    if (info.project.name === "desktop") {
      expect(cardBox.x, "card right of the ranking").toBeGreaterThan(rankBox.x + rankBox.width);
      expect(cardBox.width).toBeGreaterThanOrEqual(280);
      expect(cardBox.width).toBeLessThanOrEqual(400);
    } else {
      expect(cardBox.y, "card under the ranking").toBeGreaterThan(rankBox.y + rankBox.height - 1);
    }
    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("C3 a typist with no bonuses reads NONE both ways; a cut line reads its status", async ({
    page,
    request,
  }) => {
    await report(page, request, (host) =>
      six(host).map((d) =>
        d.desk === 4 ? { ...d, userId: host } : d.desk === 7 ? { ...d, userId: null } : d,
      ),
    );
    await expect(card(page).locator('[data-row="sent"] dd')).toHaveText("NONE");
    await expect(card(page).locator('[data-row="received"] dd')).toHaveText("NONE");
    await expect(card(page).locator('[data-field="status"]')).toHaveText("LINE CUT");
    await expect(card(page).locator('[data-field="place"]')).toHaveText("№ 4");
  });

  test("C3 a spectator: no card, the ranking takes the full width", async ({ page, request }) => {
    await report(page, request, (host) => six(host).map((d) => ({ ...d, userId: null })));
    await expect(ranking(page).locator('tbody tr[data-you="true"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="personal"]')).toHaveCount(0);
    await expect(page.locator("[data-personal]")).toHaveCount(0);
    const slot = page.locator('[data-slot="ranking"]');
    const slots = (await slot.locator("..").boundingBox())!;
    const box = (await slot.boundingBox())!;
    expect(Math.abs(box.width - slots.width), "ranking spans the slots row").toBeLessThan(2);
  });
});

// Contract of #865 C4: a two-player race typed through the race server playwright.config.ts starts (the
// #143 race-again pattern: host and one guest, 10 words, untimed, both type the whole strip). The
// guest's Dawn report card draws their own trace: a graph of at least two points whose accessible name
// states the final WPM the card shows. The seeded races above post empty traces: NO TRACE ON FILE.
const graph = (page: Page) => card(page).locator('[data-section="graph"]');
const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");

test.describe("Dawn report personal card, WPM graph (#865)", () => {
  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C4 after a typed race the typist's card graphs their WPM and names their final WPM", async ({
    page,
    browser,
  }) => {
    test.skip(test.info().project.name !== "desktop", "race server races run on desktop");
    test.setTimeout(scaled(120_000));
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, { wordCount: 10, timerS: null });
    await openRace(page, room);
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(RACE_PATH);
    const raceId = RACE_PATH.exec(room.host.url())![1]!;
    const pages = [room.host, page];
    for (const p of pages) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
    }
    const texts = await Promise.all(pages.map(stripText));
    // 80 ms a key: a few seconds of race, so a few one-second buckets
    await Promise.all(pages.map((p, i) => p.keyboard.type(texts[i]!, { delay: 80 })));
    const ended = page.locator('[data-seat-status] [data-finished="ended"]');
    await expect(ended).toBeVisible({ timeout: scaled(20_000) });

    await withoutWebGL(page);
    await page.goto(`/results/${raceId}`);
    await expect(page.locator("[data-ranking] tbody tr")).toHaveCount(2, {
      timeout: scaled(15_000),
    });
    const img = graph(page).getByRole("img");
    await expect(img).toHaveCount(1);
    expect(
      Number(await graph(page).locator("[data-points]").getAttribute("data-points")),
    ).toBeGreaterThanOrEqual(2);
    const line = graph(page).locator("[data-line]");
    expect(
      ((await line.getAttribute("points")) ?? "").trim().split(/\s+/).length,
    ).toBeGreaterThanOrEqual(3); // GO plus at least two points
    const wpm = (await card(page).locator('[data-field="wpm"]').textContent())!.trim();
    await expect(img).toHaveAccessibleName(
      new RegExp(`^Peak \\d+ WPM, final ${wpm} WPM, 0 bonuses received\\.$`),
    );
    await expect(graph(page).getByText("NO TRACE ON FILE")).toHaveCount(0);
  });

  test("C3 a seeded race with no trace on file reads NO TRACE ON FILE", async ({
    page,
    request,
  }) => {
    await report(page, request, withBonuses);
    await expect(graph(page)).toContainText("NO TRACE ON FILE");
    await expect(graph(page).getByRole("img")).toHaveCount(0);
  });
});

// Contract of #867 C4: a typist who misses the same key three times in a race sees that key first in the
// list and the `key` tip naming it. The race is seeded through the signed internal routes with a trace
// for the viewer's desk: the stored text typed in full (Continue mode, the default), with a wrong key
// pressed on the first three times its most frequent letter is asked for.
const keysSection = (page: Page) => card(page).locator('[data-section="keys"]');
const tipSection = (page: Page) => card(page).locator('[data-section="tip"]');

/** The most frequent plain lowercase letter of `text` (at least three of it). */
function frequentLetter(text: string): string {
  const counts = new Map<string, number>();
  for (const c of text) if (/[a-z]/.test(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  const [letter, n] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
  expect(n).toBeGreaterThanOrEqual(3);
  return letter;
}

/** `text` typed at 120 ms a key, `letter` mistyped (as a digit) its first three times. */
function missingThrice(text: string, letter: string): Keystroke[] {
  let left = 3;
  return [...text].map((key, i) => {
    const miss = key === letter && left > 0;
    if (miss) left -= 1;
    return { t: (i + 1) * 120, key: miss ? "7" : key };
  });
}

test.describe("Dawn report personal card, errors by key and tip (#867)", () => {
  test.setTimeout(scaled(90_000));

  test("C4 a key missed three times is first in the list and named by the key tip", async ({
    page,
    request,
  }) => {
    await withoutWebGL(page);
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId);
    const raceId = await startRace(request, lobby, desks);
    const text = normalizeTypeable(await raceTextOf(raceId));
    const letter = frequentLetter(text);
    const trace = missingThrice(text, letter);
    await postResults(
      request,
      raceId,
      desks.map((d) => (d.desk === 7 ? { ...d, trace } : d)),
    );
    await page.goto(`/results/${raceId}`);
    await expect(ranking(page)).toBeVisible({ timeout: HYDRATION_WAIT });

    await expect(keysSection(page).getByRole("heading", { name: "ERRORS BY KEY" })).toBeVisible();
    const first = keysSection(page).locator("li").first();
    await expect(first.locator('[data-field="key"]')).toHaveText(letter);
    await expect(first.locator('[data-field="count"]')).toHaveText("× 3");
    await expect(tipSection(page)).toHaveAttribute("data-tip", "key");
    await expect(tipSection(page).getByRole("heading", { name: "ORDER OF THE DAY" })).toBeVisible();
    await expect(tipSection(page).locator('[data-field="tip"]')).toHaveText(
      `The ${letter} key slipped 3 times: slow down on it next race and the rest will follow.`,
    );
    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("C3 a seeded race with no trace on file: NO TRACE ON FILE, the tip from the accuracy", async ({
    page,
    request,
  }) => {
    await report(page, request, withBonuses); // the viewer's accuracy is 91 %: steady
    await expect(keysSection(page)).toContainText("NO TRACE ON FILE");
    await expect(tipSection(page)).toHaveAttribute("data-tip", "steady");
  });
});

// Contract of #999 C54: the compact keyboard heatmap (bible 14.3: paper, gold, red) under the errors by
// key, from the viewer's own trace on their layout (a guest with no saved layout, English: US QWERTY).
// The same seeded race as #867 C4: one letter mistyped its first three times.
const heatmap = (page: Page) => card(page).locator('[data-section="heatmap"]');

test.describe("Dawn report keyboard heatmap (#999 C54)", () => {
  test.setTimeout(scaled(90_000));

  test("C54 the missed key runs hot on the viewer's keyboard; untyped keys stay newsprint", async ({
    page,
    request,
  }) => {
    await withoutWebGL(page);
    const lobby = await seedLobby(page);
    const desks = six(lobby.hostUserId);
    const raceId = await startRace(request, lobby, desks);
    const text = normalizeTypeable(await raceTextOf(raceId));
    const letter = frequentLetter(text);
    await postResults(
      request,
      raceId,
      desks.map((d) => (d.desk === 7 ? { ...d, trace: missingThrice(text, letter) } : d)),
    );
    await page.goto(`/results/${raceId}`);
    await expect(ranking(page)).toBeVisible({ timeout: HYDRATION_WAIT });

    await expect(heatmap(page)).toHaveAttribute("data-layout", "US_QWERTY");
    await expect(heatmap(page).getByRole("heading", { name: "KEYBOARD HEATMAP" })).toBeVisible();
    const board = heatmap(page).getByRole("img");
    await expect(board).toHaveAccessibleName(
      new RegExp(`^Keyboard heatmap, US QWERTY: ${letter.toUpperCase()} × 3[,.]`),
    );
    const hot = heatmap(page).locator(`[data-key="${letter}"]`);
    await expect(hot).toHaveAttribute("data-state", "missed");
    await expect(hot).toHaveAttribute("data-errors", "3");
    // the race's most missed key: the band is all red (heat 1)
    expect(await hot.evaluate((el) => getComputedStyle(el).getPropertyValue("--heat").trim())).toBe(
      "1",
    );
    const absent = "qwertyuiopasdfghjklzxcvbnm"
      .split("")
      .find((c) => !text.toLowerCase().includes(c));
    if (absent) {
      await expect(heatmap(page).locator(`[data-key="${absent}"]`)).toHaveAttribute(
        "data-state",
        "untyped",
      );
    }
    // between the errors by key and the tip; inside the card's width
    const keysBox = (await keysSection(page).boundingBox())!;
    const heatBox = (await heatmap(page).boundingBox())!;
    const tipBox = (await tipSection(page).boundingBox())!;
    expect(heatBox.y).toBeGreaterThanOrEqual(keysBox.y + keysBox.height - 1);
    expect(tipBox.y).toBeGreaterThanOrEqual(heatBox.y + heatBox.height - 1);
    const cardBox = (await card(page).boundingBox())!;
    expect(heatBox.x + heatBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    const [scrollWidth, clientWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("C54 a seeded race with no trace on file has no heatmap", async ({ page, request }) => {
    await report(page, request, withBonuses);
    await expect(keysSection(page)).toContainText("NO TRACE ON FILE");
    await expect(heatmap(page)).toHaveCount(0);
  });
});

// Contract of #999 C51, C52 (ADR 0027): the WPM graph draws the other typists' stored lines, each in its
// desk's rival ink, with a toggle of real checkboxes (you, the winner and the last place first; a bot's
// flat line simulated; several at once), in both languages; a flagged desk never shows; a viewer who is
// neither a participant nor the host gets no other line. Typists with stored series need users: they are
// written straight into the test database (as a guest's first visit would).
async function guests(n: number): Promise<string[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = `e2e-${randomUUID()}`;
      await db.query(`INSERT INTO "User" (id, "typistName") VALUES ($1, $2)`, [
        id,
        `E2E-${id.slice(-12)}`,
      ]);
      ids.push(id);
    }
    return ids;
  } finally {
    await db.end();
  }
}

/** `text` typed in full, one key every `every` ms. */
const typedAt = (text: string, every: number): Keystroke[] =>
  [...text].map((key, i) => ({ t: (i + 1) * every, key }));

const checkbox = (page: Page, name: string | RegExp) => graph(page).getByRole("checkbox", { name });
const lineOf = (page: Page, desk: number) => graph(page).locator(`[data-line-desk="${desk}"]`);

test.describe("Dawn report WPM graph, every typist's line (#999 C51, C52)", () => {
  test.setTimeout(scaled(120_000));

  test("C52 lines in rival inks, a keyboard toggle, both languages; flagged and outsiders get none", async ({
    page,
    request,
    browser,
  }) => {
    await withoutWebGL(page);
    const lobby = await seedLobby(page);
    const [winner, flagged, last] = await guests(3);
    const seeded = (trace: (every: number) => Keystroke[]): Desk[] => [
      { desk: 3, name: "Clerk-Winner", place: 1, wpm: 70, userId: winner, trace: trace(90) },
      { desk: 7, name: "Lynx-785", place: 2, wpm: 55, userId: lobby.hostUserId, trace: trace(120) },
      { desk: 5, name: "Typist Bot 5", place: 3, wpm: 40, isBot: true },
      {
        desk: 11,
        name: "Clerk-Flagged",
        place: 4,
        wpm: 99,
        userId: flagged,
        suspicious: true,
        trace: trace(60),
      },
      { desk: 9, name: "Clerk-Last", place: 5, wpm: 20, userId: last, trace: trace(200) },
    ];
    const raceId = await startRace(
      request,
      lobby,
      seeded(() => []),
    );
    const text = normalizeTypeable(await raceTextOf(raceId));
    await postResults(
      request,
      raceId,
      seeded((every) => typedAt(text, every)),
    );
    await page.goto(`/results/${raceId}`);
    await expect(ranking(page)).toBeVisible({ timeout: HYDRATION_WAIT });

    // you, the winner and the last place first; the bot unticked; the flagged desk absent
    await expect(graph(page).getByRole("group", { name: "LINES ON THE GRAPH" })).toBeVisible();
    await expect(graph(page).getByRole("checkbox")).toHaveCount(4);
    await expect(checkbox(page, "YOU")).toBeChecked();
    await expect(checkbox(page, "№ 1 · Clerk-Winner · 70 WPM")).toBeChecked();
    await expect(checkbox(page, "№ 5 · Clerk-Last · 20 WPM")).toBeChecked();
    const bot = checkbox(page, /^№ 3 · Typist Bot 5 · 40 WPM\s*SIMULATED$/);
    await expect(bot).not.toBeChecked();
    await expect(graph(page).getByText("Clerk-Flagged")).toHaveCount(0);
    await expect(lineOf(page, 11)).toHaveCount(0);

    // several lines, each in its desk's rival ink; the viewer's own the ink line
    await expect(graph(page).locator("[data-line]")).toHaveCount(1);
    await expect(lineOf(page, 3)).toHaveAttribute("data-ink", `rival-${deskIdentity(3).color}`);
    await expect(lineOf(page, 9)).toHaveAttribute("data-ink", `rival-${deskIdentity(9).color}`);
    await expect(lineOf(page, 5)).toHaveCount(0);
    expect(
      ((await lineOf(page, 3).getAttribute("points")) ?? "").split(" ").length,
    ).toBeGreaterThan(2);

    // the keyboard alone: Tab to the bot's box, Space ticks it (several at once), Space again unticks
    await bot.focus();
    await page.keyboard.press("Space");
    await expect(bot).toBeChecked();
    await expect(lineOf(page, 5)).toHaveAttribute("data-simulated", "true");
    await expect(graph(page).locator("[data-line-desk]")).toHaveCount(3);
    await page.keyboard.press("Shift+Tab");
    await expect(checkbox(page, "№ 1 · Clerk-Winner · 70 WPM")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(checkbox(page, "№ 1 · Clerk-Winner · 70 WPM")).not.toBeChecked();
    await expect(lineOf(page, 3)).toHaveCount(0);
    await expect(graph(page).locator("[data-line-desk]")).toHaveCount(2);

    // French
    await page.context().addCookies([{ name: "locale", value: "fr", url: page.url() }]);
    await page.reload();
    await expect(graph(page).getByRole("group", { name: "COURBES AFFICHÉES" })).toBeVisible({
      timeout: HYDRATION_WAIT,
    });
    await expect(checkbox(page, "TOI")).toBeChecked();
    await expect(checkbox(page, "№ 1 · Clerk-Winner · 70 MPM")).toBeChecked();
    await expect(checkbox(page, /^№ 3 · Typist Bot 5 · 40 MPM\s*SIMULÉ$/)).not.toBeChecked();

    // a viewer who is neither a participant nor the host: no other line, none in the page at all
    const outsider = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const other = await outsider.newPage();
      await withoutWebGL(other);
      await createLobby(other); // a guest of their own, with a lobby of their own
      await other.goto(`/results/${raceId}`);
      await expect(other.locator("[data-ranking]")).toBeVisible({ timeout: HYDRATION_WAIT });
      await expect(other.locator("[data-line-desk]")).toHaveCount(0);
      await expect(other.locator("[data-toggle]")).toHaveCount(0);
      const html = await other.content();
      expect(html).not.toContain("data-line-desk");
      expect(html).not.toContain("data-line-choice");
    } finally {
      await outsider.close();
    }
  });
});
