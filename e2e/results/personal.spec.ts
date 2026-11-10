import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "../race/helpers";
import { HYDRATION_WAIT, scaled } from "../timeouts";
import { postResults, seedLobby, six, startRace, withoutWebGL, type Desk } from "./helpers";

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
    await page.goto(`/race/${room.lobbyId}`);
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
