import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  SEAT_HUD,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #240 C2, C3 and C4 over the race server playwright.config.ts starts. Host (English) and
// one guest (French) in a room with a 1-minute timer (the minimum: `RACE_FAST_CLOCK=1` scales the
// countdown, grace and idle rules, never `timerS`, so the race really lasts 60 s). The guest types the
// whole strip and finishes first: its finish stamp (`ACCEPTÉ · n MPM`, or `RETOURNÉ · n FAUTES`) slams
// through the #232 queue, its input locks, and the FILED docket shows `01 / 02` and the live standings.
// The host keeps typing one correct key every 3 s (under the fast clock's 4.5 s idle warning), so the
// race ends on the timer, not because an idle host fell asleep. At the timer's end both pages show the
// RACE OVER docket: TIME'S UP, the guest first, the host second and TIMED OUT, and the DAWN REPORT link
// to `/results/<raceId>`, which resolves (#300).

const tube = (page: Page, which: "wpm" | "place" | "timer") =>
  SEAT_HUD.nixie(page).locator(`[data-tube="${which}"]`);
const docket = (page: Page, mode: "finished" | "ended") =>
  page.locator(`[data-seat-status] [data-finished="${mode}"]`);
const row = (scope: Locator, desk: number) => scope.locator(`li[data-desk="${desk}"]`);
const seconds = (mmss: string | null) => {
  const m = /^(\d{2}):(\d{2})$/.exec(mmss ?? "");
  expect(m, `mm:ss, got ${mmss}`).not.toBeNull();
  return Number(m![1]) * 60 + Number(m![2]);
};
const deskOf = async (page: Page) =>
  Number(/(\d{2})$/.exec((await SEAT_HUD.kicker(page).textContent()) ?? "")![1]);
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");

test.describe("#240 race timer and finished waiting view", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C2 C3 C4: the timer counts down on both pages, the guest finishes first, the timer ends the race", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(150_000));
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, { timerS: 60, wordCount: 10 });
    await page
      .context()
      .addCookies([{ name: "locale", value: "fr", url: test.info().project.use.baseURL! }]);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(SEAT_HUD.kicker(page)).toHaveText(/\d{2}$/);
    await expect(startButton(room.host)).toBeEnabled();
    const guestDesk = await deskOf(page);

    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    const raceId = /\/race\/([0-9a-f-]{36})$/.exec(room.host.url())![1]!;
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
    }
    const hostDesk = await deskOf(room.host);
    expect(hostDesk).not.toBe(guestDesk);

    // C4: the timer tube counts down on both pages, within 1 s of each other
    const [g0, h0] = await Promise.all([
      tube(page, "timer").textContent(),
      tube(room.host, "timer").textContent(),
    ]);
    expect(Math.abs(seconds(g0) - seconds(h0))).toBeLessThanOrEqual(1);
    expect(seconds(g0)).toBeLessThanOrEqual(60);
    expect(seconds(g0)).toBeGreaterThan(40);
    await expect(SEAT_HUD.nixie(room.host)).toHaveAttribute("aria-label", /, \d{2}:\d{2} left$/);
    await expect(SEAT_HUD.nixie(page)).toHaveAttribute("aria-label", /, \d{2}:\d{2} restant$/);

    // the host stays awake: one correct key every 3 s, so the timer (not the idle rule) ends the race
    const hostText = Array.from(await stripText(room.host));
    let awake = true;
    const keepAwake = (async () => {
      for (let i = 0; awake && i < hostText.length - 1; i++) {
        await room.host.keyboard.type(hostText[i]!);
        for (let w = 0; awake && w < 30; w++) await room.host.waitForTimeout(100);
      }
    })();

    try {
      // C2: the guest types the whole strip and finishes first
      const text = await stripText(page);
      expect(text.length).toBeGreaterThan(20);
      await page.keyboard.type(text, { delay: 40 });
      const stamp = page.locator('[data-stamps="accepted"], [data-stamps="returned"]');
      await expect(stamp).toBeVisible({ timeout: scaled(5_000) });
      await expect(stamp).toHaveText(
        /^(ACCEPTÉ · \d+ MPM|RETOURNÉ · 1 FAUTE|RETOURNÉ · \d+ FAUTES)$/,
      );
      await expect(page.getByRole("textbox", { name: "Texte à taper" })).toBeDisabled();
      await expect(tube(page, "place")).toHaveText("01 / 02");
      const filed = docket(page, "finished");
      await expect(filed).toBeVisible();
      await expect(filed.locator("> div").first()).toHaveText(/^CLASSÉ\s*01 \/ 02$/);
      // the live standings: every desk by rank, updating with each snapshot
      await expect(filed.locator("li")).toHaveCount(2);
      await expect(filed.locator("li").first()).toHaveAttribute("data-desk", String(guestDesk));
      await expect(row(filed, guestDesk)).toContainText("100 %");
      await expect(row(filed, guestDesk)).toContainText("TOI");
      await expect(row(filed, guestDesk)).toContainText("CLASSÉ");
      await expect(row(filed, hostDesk)).toContainText(/^02BUREAU \d{2}/);
      const hostBefore = (await row(filed, hostDesk).textContent()) ?? "";
      await expect(row(filed, hostDesk)).not.toHaveText(hostBefore, { timeout: scaled(8_000) });

      // the timer keeps counting down while the guest waits; the host is still typing
      await expect(tube(room.host, "place")).toHaveText("02 / 02");
      await expect(docket(room.host, "finished")).toHaveCount(0);

      // C3 C4: at the timer's end both pages show RACE OVER, the host unfinished and ranked second
      const over = docket(page, "ended");
      await expect(over).toBeVisible({ timeout: scaled(75_000) });
      awake = false;
      const hostOver = docket(room.host, "ended");
      await expect(hostOver).toBeVisible({ timeout: scaled(5_000) });
      await expect(over.locator("> div").first()).toHaveText(/^COURSE TERMINÉE\s*TEMPS ÉCOULÉ$/);
      await expect(hostOver.locator("> div").first()).toHaveText(/^RACE OVER\s*TIME'S UP$/);
      for (const [scope, filedWord, timedOut] of [
        [over, "CLASSÉ", "TEMPS ÉCOULÉ"],
        [hostOver, "FILED", "TIMED OUT"],
      ] as const) {
        await expect(scope.locator("li")).toHaveCount(2);
        await expect(scope.locator("li").nth(0)).toHaveAttribute("data-desk", String(guestDesk));
        await expect(scope.locator("li").nth(1)).toHaveAttribute("data-desk", String(hostDesk));
        await expect(row(scope, guestDesk)).toContainText(filedWord);
        await expect(row(scope, hostDesk)).toContainText(/^02/);
        await expect(row(scope, hostDesk)).toContainText(timedOut);
      }
      await expect(tube(page, "timer")).toHaveText("00:00");
      await expect(tube(room.host, "timer")).toHaveText("00:00");
      await expect(room.host.getByRole("textbox", { name: "Text to type" })).toBeDisabled();

      // the DAWN REPORT ink link to the results route, which resolves
      const link = room.host.getByRole("link", { name: "DAWN REPORT →" });
      await expect(link).toHaveAttribute("href", `/results/${raceId}`);
      await expect(page.getByRole("link", { name: "RAPPORT DE L'AUBE →" })).toHaveAttribute(
        "href",
        `/results/${raceId}`,
      );
      expect((await room.host.request.get(`/results/${raceId}`)).status()).toBe(200);
    } finally {
      awake = false;
      await keepAwake.catch(() => {});
    }
  });
});
