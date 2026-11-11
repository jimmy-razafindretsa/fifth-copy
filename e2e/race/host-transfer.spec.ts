import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { ACTION_WAIT, scaled } from "../timeouts";
import {
  hostRoom,
  joinAsGuest,
  phaseOf,
  recordRaceTokens,
  SEAT_HUD,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #868 C3 over the race server playwright.config.ts starts. The host and two guests, A
// joined before B, race (Block mode, 30 words, untimed). The host closes its page mid-race: its desk is
// line-cut, and once its grace runs out (ARCHITECTURE 7.4: 2 minutes; 20 s in e2e, `RACE_GRACE_MS`)
// the desk expires and the race server promotes A (#137). A and B then see the ink stamp
// `NEW HOST: <A>` on the seat view within 3 s (B under reduced motion: no slam); A keeps the keyboard and
// the keys A types while it shows all count. A and B keep typing a key now and then meanwhile, so the
// idle rule (45 s / 60 s, a tenth under the fast clock) never puts them to sleep. Both finish, open the
// Dawn report and follow RACE AGAIN: A's waiting room has START enabled, B's has none.

const FAST = process.env.RACE_FAST_CLOCK === "1";
/**
 * The race server's reconnection grace of a line-cut desk: `RACE_GRACE_MS`, which playwright.config.ts
 * sets for this run (20 s), else `GRACE_MS` of durations.ts (2 minutes, 12 s under the fast clock).
 */
const GRACE_MS = Number(process.env.RACE_GRACE_MS) || (FAST ? 12_000 : 120_000);
/** A key from each guest this often keeps the idle warning (4.5 s / 45 s) away. */
const KEEP_ALIVE_MS = FAST ? 1_500 : 10_000;

const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const stamp = (page: Page) => page.locator('[data-stamps="new-host"]');
const done = (page: Page) => page.locator('[data-sheet] [data-state="done"]');
const ended = (page: Page) => page.locator('[data-seat-status] [data-finished="ended"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const deskOf = async (page: Page) =>
  Number(/(\d{2})$/.exec((await SEAT_HUD.kicker(page).textContent()) ?? "")![1]);
const laneOf = (page: Page, desk: number) =>
  SEAT_HUD.raceCard(page).locator(`[data-lane][data-desk="${desk}"]`);
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" }).locator("li");
const inputFocused = (page: Page) => input(page).evaluate((el) => el === document.activeElement);

/** The viewer's own name in the waiting room: the roll row that carries the YOU tag. */
async function ownName(page: Page): Promise<string> {
  const row = roll(page).filter({ has: page.getByText("YOU", { exact: true }) });
  return ((await row.locator("span").nth(2).textContent()) ?? "").trim();
}

/** Types the next `n` characters of the race text (Block mode: each one is right, so each counts). */
async function typeNext(page: Page, text: string, n: number) {
  const at = await done(page).count();
  await page.keyboard.type(text.slice(at, at + n), { delay: 40 });
}

test.describe("#868 new host during a race", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C3 the host's desk expires: A and B see NEW HOST: <A>, A's keys count, A starts the next race", async ({
    browser,
  }) => {
    test.setTimeout(scaled(GRACE_MS + 120_000));
    const { host, code, lobbyId, context } = await hostRoom(browser, opened, {
      before: recordRaceTokens,
    });
    await setHostSettings(host, { errorMode: "block", wordCount: 30, timerS: null });
    const a = await joinAsGuest(browser, code);
    opened.push(a.context);
    await expect(roll(host)).toHaveCount(2, { timeout: ACTION_WAIT });
    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    await b.page.emulateMedia({ reducedMotion: "reduce" });
    for (const page of [host, a.page, b.page])
      await expect(roll(page)).toHaveCount(3, { timeout: ACTION_WAIT });
    const nameA = await ownName(a.page);
    const guests = [a.page, b.page];

    // the race: the host's START moves every waiting room to the seat view
    await warmRace(host, lobbyId);
    await expect(startButton(host)).toBeEnabled();
    await startButton(host).click();
    for (const page of [host, ...guests]) {
      await expect(page).toHaveURL(RACE_PATH, { timeout: ACTION_WAIT });
      await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(15_000),
      });
    }
    const raceId = RACE_PATH.exec(a.page.url())![1]!;
    const hostDesk = await deskOf(host);
    const texts = await Promise.all(guests.map(stripText));
    for (const page of guests) await expect(input(page)).toBeFocused();

    // the host closes its page: its desk is cut, then expires after the grace
    await host.close();
    await context.close();
    await expect(laneOf(a.page, hostDesk)).toHaveAttribute("data-status", "line-cut", {
      timeout: ACTION_WAIT,
    });
    // the lane is read every 200 ms, so the expiry is seen at once; a key goes every KEEP_ALIVE_MS
    const deadline = Date.now() + scaled(GRACE_MS + 20_000);
    let keptAlive = 0;
    while (Date.now() < deadline) {
      if ((await laneOf(a.page, hostDesk).getAttribute("data-status")) === "expired") break;
      if (Date.now() - keptAlive >= KEEP_ALIVE_MS) {
        for (const [i, page] of guests.entries()) await typeNext(page, texts[i]!, 1);
        keptAlive = Date.now();
      }
      await a.page.waitForTimeout(200);
    }
    await expect(laneOf(a.page, hostDesk)).toHaveAttribute("data-status", "expired");

    // within 3 s of the expiry: the ink NEW HOST stamp with A's name on both seats
    for (const page of guests) {
      await expect(stamp(page)).toHaveText(`NEW HOST: ${nameA.toUpperCase()}`, {
        timeout: scaled(3_000),
      });
      await expect(stamp(page).locator("[data-stamp-tone]")).toHaveAttribute(
        "data-stamp-tone",
        "ink",
      );
    }
    // static under reduced motion (B)
    expect(
      await stamp(b.page)
        .locator("[data-stamp-tone]")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");

    // A keeps the keyboard: the keys typed while the stamp shows all count
    expect(await inputFocused(a.page)).toBe(true);
    const before = await done(a.page).count();
    await typeNext(a.page, texts[0]!, 4);
    await expect(done(a.page)).toHaveCount(before + 4);
    await expect(stamp(a.page)).toBeVisible();
    expect(await inputFocused(a.page)).toBe(true);
    await expectNoA11yViolations(a.page);

    // it goes after its hold (slow x 5 = 3 s)
    await expect(stamp(a.page)).toHaveCount(0, { timeout: scaled(6_000) });

    // both finish: the host's expired desk does not hold the race
    await Promise.all(
      guests.map(async (page, i) => {
        const at = await done(page).count();
        await page.keyboard.type(texts[i]!.slice(at), { delay: 30 });
      }),
    );
    for (const page of guests) await expect(ended(page)).toBeVisible({ timeout: scaled(20_000) });

    // after the race: the Dawn report, RACE AGAIN, and A hosts the waiting room
    for (const page of guests) {
      await page.getByRole("link", { name: "DAWN REPORT →" }).click();
      await expect(page).toHaveURL(`/results/${raceId}`);
      const again = page.getByRole("link", { name: "RACE AGAIN", exact: true });
      await expect(again).toHaveAttribute("href", `/lobby/${code}`, { timeout: ACTION_WAIT });
      await again.click();
      await expect(page).toHaveURL(`/lobby/${code}`);
    }
    for (const page of guests) await expect(roll(page)).toHaveCount(2, { timeout: ACTION_WAIT });
    await expect(startButton(a.page)).toBeEnabled({ timeout: ACTION_WAIT });
    await expect(startButton(b.page)).toHaveCount(0);
  });
});
