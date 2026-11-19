import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { HYDRATION_WAIT, LOAD_LIMIT_MS, scaled } from "../timeouts";
import {
  cuttableLine,
  hostRoom,
  recordRaceTokens,
  SEAT_HUD,
  setHostSettings,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #999 C1, C3, C6, C7 (bible 14.3 "Projector view", ARCHITECTURE 7.8): `/race/<id>?view=
// projector` joins the room as a spectator (no desk: no typing surface, never a `keys` or `ready` frame),
// shows each room state at the projector scale, the paper ring diagram as its stage (the scene is off in
// e2e, `e2e/fixtures.ts`) and the top 10 beside it. Real web app and race server (playwright.config.ts).

const projector = {
  root: (p: Page) => p.locator("[data-projector]"),
  state: (p: Page) => p.locator("[data-projector-state]"),
  kicker: (p: Page) => p.getByRole("heading", { level: 1 }),
  ring: (p: Page) => p.locator('[data-projector-stage] [data-scene="paper"] [role="img"]'),
  sidebar: (p: Page) => p.locator("[data-top10]"),
  rows: (p: Page) => p.locator("[data-top10] li"),
  notice: (p: Page) => p.locator("[data-projector-status] [data-notice]"),
};

/** Every frame the page's race sockets send (`42["keys"…`, `42["ready"…` must never be among them). */
function sentFrames(page: Page): string[] {
  const sent: string[] = [];
  page.on("websocket", (ws) => ws.on("framesent", ({ payload }) => void sent.push(String(payload))));
  return sent;
}

/** No typing surface and no desk control anywhere on the page (C1). */
async function expectNoDesk(page: Page) {
  await expect(page.getByRole("textbox")).toHaveCount(0);
  for (const part of [SEAT_HUD.telex, SEAT_HUD.machine, SEAT_HUD.tray, SEAT_HUD.abandon, SEAT_HUD.sheet])
    await expect(part(page)).toHaveCount(0);
}

/** C7: the sidebar's rows and the kicker in px at the current viewport; nothing scrolls. */
async function readability(page: Page) {
  return page.evaluate(() => {
    const px = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
    const side = document.querySelector("[data-top10]")!;
    return {
      row: px(document.querySelector("[data-top10] li")),
      kicker: px(document.querySelector("[data-projector] h1")),
      sideways: document.documentElement.scrollWidth > window.innerWidth,
      downward: document.documentElement.scrollHeight > window.innerHeight,
      sideClipped: side.scrollHeight > side.clientHeight + 1,
    };
  });
}

test.describe("#999 the projector view", () => {
  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test("C1 C3 C6 C7 a spectator page through waiting, loading, countdown, racing and finished: no desk, the top 10 in rank order, readable at 1080p and 4K, axe clean in light and Night shift", async ({
    browser,
  }, info) => {
    test.skip(info.project.use.viewport?.width !== 1280, "desktop project");
    test.setTimeout(scaled(150_000) + LOAD_LIMIT_MS);
    const { host, lobbyId } = await hostRoom(browser, opened, { before: recordRaceTokens });
    // the host watches (#876): the twelve simulated typists are the whole field, so the race ends
    await setHostSettings(host, { hostWatches: true, wordCount: 10 });
    players = [
      ...(await simulatedPlayers(11, lobbyId)),
      // one typist never reports ready: the room waits out its load limit (#926), READY reads 11 / 12
      ...(await simulatedPlayers(1, lobbyId, { names: ["Sim-held"], ready: false })),
    ];

    const context = await browser.newContext({ baseURL: info.project.use.baseURL });
    opened.push(context);
    const page = await context.newPage();
    const sent = sentFrames(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/race/${lobbyId}?view=projector`);

    // waiting: the kicker, the paper ring with every desk, the roster in the sidebar with no place yet
    await expect(projector.kicker(page)).toHaveText("PROJECTOR VIEW");
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "waiting", {
      timeout: HYDRATION_WAIT,
    });
    await expect(projector.ring(page)).toBeVisible();
    await expect(projector.sidebar(page)).toContainText("12 TYPISTS");
    await expect(projector.rows(page)).toHaveCount(10);
    await expect(projector.rows(page).first()).toContainText("··");
    await expect(page.locator('[data-notice="no-scene"]')).toHaveCount(0);
    await expectNoDesk(page);
    await expectNoA11yViolations(page);

    // loading: the loading card with the READY count; the projector is never awaited
    await expect(startButton(host)).toBeEnabled({ timeout: scaled(20_000) });
    await warmRace(host, lobbyId);
    await startButton(host).click();
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "loading", {
      timeout: HYDRATION_WAIT,
    });
    await expect(page.locator("[data-projector-status] [data-ready]")).toContainText("11 / 12", {
      timeout: scaled(10_000),
    });
    await expectNoDesk(page);
    await expectNoA11yViolations(page);

    // countdown, then racing: the 3-2-1 over the stage, then nothing; the projector still never sends
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "countdown", {
      timeout: LOAD_LIMIT_MS + scaled(15_000),
    });
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "racing", {
      timeout: scaled(15_000),
    });
    // distinct progress: player i types 2 * (12 - i) characters, so desk order = player order
    for (const [i, p] of players.entries()) await p.type(2 * (players.length - i));
    const leaders = players.slice(0, 10).map((p) => String(p.desk));
    await expect
      .poll(() => projector.rows(page).evaluateAll((li) => li.map((l) => l.getAttribute("data-desk"))), {
        message: "the top 10 by the server's rank",
        timeout: scaled(15_000),
      })
      .toEqual(leaders);
    await expect(projector.rows(page).first()).toHaveAttribute("data-place", "1");
    await expect(projector.rows(page).nth(9)).toHaveAttribute("data-place", "10");
    await expect(projector.sidebar(page)).not.toContainText("YOU");
    await expectNoDesk(page);

    // C7 readability: 28 px rows and a 20 px kicker at 1080p, twice that at 4K; nothing scrolls
    const hd = await readability(page);
    expect(hd.row).toBeGreaterThanOrEqual(28);
    expect(hd.kicker).toBeGreaterThanOrEqual(20);
    expect(hd).toMatchObject({ sideways: false, downward: false, sideClipped: false });
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 3840, height: 2160 });
    const uhd = await readability(page);
    expect(uhd.row).toBeGreaterThanOrEqual(56);
    expect(uhd.kicker).toBeGreaterThanOrEqual(40);
    expect(uhd).toMatchObject({ sideways: false, downward: false, sideClipped: false });
    await page.setViewportSize({ width: 1920, height: 1080 });

    // finished: every typist completes; RACE OVER with the Dawn report link, the final top 10 in WPM
    for (const p of players) await p.type(10_000);
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "finished", {
      timeout: scaled(20_000),
    });
    await expect(page.locator('[data-finished="ended"]')).toContainText("RACE OVER");
    await expect(page.getByRole("link", { name: /DAWN REPORT/ })).toHaveAttribute(
      "href",
      /^\/results\/[0-9a-f-]{36}$/,
    );
    await expect(projector.rows(page)).toHaveCount(10);
    await expect(projector.rows(page).first()).toContainText("WPM");
    await expectNoDesk(page);
    await expectNoA11yViolations(page);

    const frames = sent.filter((f) => f.startsWith('42["keys"') || f.startsWith('42["ready"'));
    expect(frames, "the projector never sends keys or ready").toEqual([]);
  });

  test("C1 C6 the host's own seat stays its desk beside the projector; a cut line reads LINE CUT · RECONNECTING and recovers", async ({
    browser,
  }, info) => {
    test.skip(info.project.use.viewport?.width !== 1280, "desktop project");
    test.setTimeout(scaled(120_000) + LOAD_LIMIT_MS);
    const { context, host, lobbyId } = await hostRoom(browser, opened, { before: recordRaceTokens });
    players = await simulatedPlayers(1, lobbyId);

    // the host's own context opens the projector: a spectator token, the host's desk untouched
    const own = await context.newPage();
    await own.goto(`/race/${lobbyId}?view=projector`);
    await expect(projector.state(own)).toHaveAttribute("data-projector-state", "waiting", {
      timeout: HYDRATION_WAIT,
    });
    // a second projector in a context of its own, its line cuttable
    const other = await browser.newContext({ baseURL: info.project.use.baseURL });
    opened.push(other);
    const page = await other.newPage();
    const line = await cuttableLine(page);
    await page.goto(`/race/${lobbyId}?view=projector`);
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "waiting", {
      timeout: HYDRATION_WAIT,
    });
    await expect(projector.sidebar(page)).toContainText("2 TYPISTS");

    await expect(startButton(host)).toBeEnabled({ timeout: scaled(20_000) });
    await warmRace(host, lobbyId);
    await startButton(host).click();
    await expect(host).toHaveURL(/\/race\/[0-9a-f-]{36}$/, { timeout: HYDRATION_WAIT });
    // the host's seat is its desk; its projector tab stays a projector
    await expect(SEAT_HUD.kicker(host)).toHaveText(/\d{2}$/, { timeout: HYDRATION_WAIT });
    await expect(SEAT_HUD.telex(host)).toHaveCount(1);
    await expect(projector.kicker(own)).toHaveText("PROJECTOR VIEW");
    await expectNoDesk(own);
    for (const p of [own, page])
      await expect(projector.state(p)).toHaveAttribute("data-projector-state", "racing", {
        timeout: LOAD_LIMIT_MS + scaled(20_000),
      });

    // connection lost: the seat view's notice, then back to the race
    await line.goOffline();
    await expect(projector.notice(page)).toHaveAttribute("data-notice", "reconnecting", {
      timeout: scaled(10_000),
    });
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "reconnecting");
    await expectNoA11yViolations(page);
    await line.goOnline();
    await expect(projector.state(page)).toHaveAttribute("data-projector-state", "racing", {
      timeout: scaled(20_000),
    });
    await expect(projector.notice(page)).toHaveCount(0);
  });
});
