import type { Browser, BrowserContext, Page } from "@playwright/test";
import Redis from "ioredis";
import { expect, expectNoA11yViolations, LANDING, test } from "../fixtures";
import { ACTION_WAIT, HYDRATION_WAIT, LOAD_LIMIT_MS, scaled } from "../timeouts";
import {
  cuttableLine,
  hostRoom,
  openRace,
  recordRaceTokens,
  SEAT_HUD,
  setHostSettings,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #999 C9, C10, C11 (bible 14.3 "Phone spectator", spec 16.6 scenario 9): a phone (480 px
// and under) on `/race/<id>`, or arriving from the lobby, joins as a spectator: no desk, no typing
// surface, never a `keys` frame, and the race server's keystroke traces do not grow from its keys. Its
// screen (360 to 430 px, light and Night shift) carries the standings with the rival markers, the CSS
// ring diagram (no three.js), every room state and the Dawn report link, with no horizontal scroll.
// Real web app and race server (playwright.config.ts).

const phone = {
  root: (p: Page) => p.locator("[data-phone-screen]"),
  kicker: (p: Page) => p.getByRole("heading", { level: 1 }),
  notice: (p: Page) => p.locator('[data-phone-screen] > [data-notice="phones"]'),
  state: (p: Page) => p.locator("[data-projector-state]"),
  ring: (p: Page) => p.locator('[data-phone-ring] [data-seat-ring][role="img"]'),
  rows: (p: Page) => p.locator("[data-top10] li"),
  status: (p: Page) => p.locator("[data-projector-status] [data-notice]"),
};

const PHONE = { width: 375, height: 812 };

/** A fresh context at a phone's size (the page's role is decided at mount). */
async function phonePage(browser: Browser, opened: BrowserContext[]) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: PHONE,
  });
  opened.push(context);
  return context.newPage();
}

/** Every frame the page's race sockets send (`42["keys"…`, `42["ready"…` must never be among them). */
function sentFrames(page: Page): string[] {
  const sent: string[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", ({ payload }) => void sent.push(String(payload))),
  );
  return sent;
}

/** No typing surface and no desk control anywhere on the page (C9). */
async function expectNoDesk(page: Page) {
  await expect(page.getByRole("textbox")).toHaveCount(0);
  for (const part of [SEAT_HUD.telex, SEAT_HUD.machine, SEAT_HUD.tray, SEAT_HUD.sheet])
    await expect(part(page)).toHaveCount(0);
  await expect(page.locator("[data-hud]")).toHaveCount(0);
}

/** C10: nothing scrolls sideways; no WebGL canvas (the ring is CSS). */
async function expectPhoneFit(page: Page) {
  const fit = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - window.innerWidth,
    canvases: document.querySelectorAll("canvas").length,
  }));
  expect(fit.sideways, "horizontal scroll").toBeLessThanOrEqual(0);
  expect(fit.canvases, "no three.js canvas").toBe(0);
}

/** Every width of C10, light and Night shift: fits, axe clean. */
async function expectEveryPhone(page: Page) {
  for (const width of [360, 430, PHONE.width]) {
    await page.setViewportSize({ width, height: PHONE.height });
    await expectPhoneFit(page);
  }
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectNoA11yViolations(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/** C11: the race server's keystroke traces of the room (`room:<lobbyId>:trace:<desk>`), summed. */
async function tracedKeys(lobbyId: string): Promise<number> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set (load the .env)");
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  try {
    const keys = await redis.keys(`room:${lobbyId}:trace:*`);
    let total = 0;
    for (const key of keys) total += await redis.llen(key);
    return total;
  } finally {
    redis.disconnect();
  }
}

test.describe("#999 the phone spectator screen", () => {
  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test("C9 C10 C11 a phone on /race/<id> watches waiting, loading, countdown, racing, connection lost and finished; its keys never reach the server", async ({
    browser,
  }, info) => {
    test.skip(
      info.project.use.viewport?.width !== 1280,
      "desktop project (the phone sets its size)",
    );
    test.setTimeout(scaled(180_000) + LOAD_LIMIT_MS);
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    const { host, lobbyId } = room;
    // the host watches (#876): the simulated typists are the whole field, so the race ends
    await setHostSettings(host, { hostWatches: true, wordCount: 10 });
    players = await simulatedPlayers(3, lobbyId);

    const page = await phonePage(browser, opened);
    const sent = sentFrames(page);
    const mints: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.headers()["next-action"]) mints.push(r.postData() ?? "");
    });
    await openRace(page, room);

    // waiting: the kicker, the phones statement, the ring of every desk, the standings with markers
    await expect(phone.kicker(page)).toHaveText("SPECTATOR VIEW", { timeout: HYDRATION_WAIT });
    await expect(phone.notice(page)).toHaveText("PHONES WATCH FROM THE BACK OF THE ROOM");
    await expect(phone.state(page)).toHaveAttribute("data-projector-state", "waiting", {
      timeout: HYDRATION_WAIT,
    });
    await expect(phone.ring(page)).toBeVisible();
    await expect(phone.ring(page)).toHaveAttribute("aria-label", /3 of 30/);
    await expect(phone.rows(page)).toHaveCount(3);
    for (const row of await phone.rows(page).all())
      await expect(row.locator("svg[data-marker]")).toHaveCount(1);
    // a spectator mint, never a desk's
    expect(mints.some((body) => body.includes('"spectator":true'))).toBe(true);
    await expectNoDesk(page);
    await expectEveryPhone(page);

    // a second phone with a cuttable line, for the connection lost state
    const cut = await phonePage(browser, opened);
    const line = await cuttableLine(cut);
    await openRace(cut, room);
    await expect(phone.state(cut)).toHaveAttribute("data-projector-state", "waiting", {
      timeout: HYDRATION_WAIT,
    });

    // loading, countdown, racing
    await expect(startButton(host)).toBeEnabled({ timeout: scaled(20_000) });
    await warmRace(host, lobbyId);
    await startButton(host).click();
    await expect(phone.state(page)).toHaveAttribute(
      "data-projector-state",
      /^(loading|countdown)$/,
      { timeout: HYDRATION_WAIT },
    );
    await expectNoDesk(page);
    await expect(phone.state(page)).toHaveAttribute("data-projector-state", "countdown", {
      timeout: LOAD_LIMIT_MS + scaled(15_000),
    });
    await expect(phone.state(page)).toHaveAttribute("data-projector-state", "racing", {
      timeout: scaled(15_000),
    });
    await expectNoDesk(page);

    // C11 (spec 16.6 scenario 9): the phone types and taps; nothing is sent, the traces do not grow
    for (const [i, p] of players.entries()) await p.type(3 * (players.length - i));
    await expect
      .poll(() => tracedKeys(lobbyId), {
        message: "the typists' keys traced",
        timeout: ACTION_WAIT,
      })
      .toBe(9 + 6 + 3);
    const before = await tracedKeys(lobbyId);
    await page.locator("body").click();
    await page.keyboard.type("The quick brown fox");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    // one more key of a typist: once it is traced, any key the phone sent before it would be too
    await players[0]!.type(1);
    await expect
      .poll(() => tracedKeys(lobbyId), { message: "only the typist's key", timeout: ACTION_WAIT })
      .toBe(before + 1);
    expect(sent.filter((f) => f.startsWith('42["keys"') || f.startsWith('42["ready"'))).toEqual([]);
    await expectNoDesk(page);

    // standings by the server's rank, each with its marker
    const leaders = players.map((p) => String(p.desk));
    await expect
      .poll(
        () => phone.rows(page).evaluateAll((li) => li.map((l) => l.getAttribute("data-desk"))),
        {
          timeout: scaled(15_000),
        },
      )
      .toEqual(leaders);
    await expect(phone.rows(page).first()).toHaveAttribute("data-place", "1");
    await expectEveryPhone(page);

    // connection lost, then back
    await expect(phone.state(cut)).toHaveAttribute("data-projector-state", "racing", {
      timeout: scaled(15_000),
    });
    await line.goOffline();
    await expect(phone.status(cut)).toHaveAttribute("data-notice", "reconnecting", {
      timeout: scaled(10_000),
    });
    await expect(phone.state(cut)).toHaveAttribute("data-projector-state", "reconnecting");
    await expectPhoneFit(cut);
    await expectNoA11yViolations(cut);
    await line.goOnline();
    await expect(phone.state(cut)).toHaveAttribute("data-projector-state", "racing", {
      timeout: scaled(20_000),
    });

    // finished: RACE OVER with the Dawn report link, the final standings in WPM
    for (const p of players) await p.type(10_000);
    await expect(phone.state(page)).toHaveAttribute("data-projector-state", "finished", {
      timeout: scaled(20_000),
    });
    await expect(page.locator('[data-finished="ended"]')).toContainText("RACE OVER");
    await expect(page.getByRole("link", { name: /DAWN REPORT/ })).toHaveAttribute(
      "href",
      /^\/results\/[0-9a-f-]{36}$/,
    );
    await expect(phone.rows(page).first()).toContainText("WPM");
    await expectNoDesk(page);
    await expectEveryPhone(page);
    expect(sent.filter((f) => f.startsWith('42["keys"') || f.startsWith('42["ready"'))).toEqual([]);
  });

  test("C9 C15 a phone that enters the room code watches the lobby, outside the seats, then the race", async ({
    browser,
  }, info) => {
    test.skip(
      info.project.use.viewport?.width !== 1280,
      "desktop project (the phone sets its size)",
    );
    test.setTimeout(scaled(120_000) + LOAD_LIMIT_MS);
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    const { host, code, lobbyId } = room;
    await setHostSettings(host, { hostWatches: true, wordCount: 10 });
    players = await simulatedPlayers(2, lobbyId);
    const roll = (p: Page) => p.getByRole("list", { name: "Typists in the room" });
    await expect(roll(host).getByRole("listitem")).toHaveCount(2);

    const page = await phonePage(browser, opened);
    const sent = sentFrames(page);
    await page.goto(LANDING);
    const form = page.getByRole("form", { name: "Watch a race" });
    await expect(form).toBeVisible();
    // phones watch: no race entry on the phone's landing (C15)
    for (const name of ["QUICK RACE", "CREATE PRIVATE RACE"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await form.getByLabel("WATCH WITH CODE OR LINK").fill(code);
    await expect(async () => {
      await form.getByRole("button", { name: "WATCH →" }).click();
      await page.waitForURL(`**/lobby/${code}`, { timeout: scaled(5_000) });
    }).toPass({ timeout: HYDRATION_WAIT });

    // the lobby: the phones statement, the roll, no START, no settings; the room counts no new seat
    await expect(page.locator('[data-notice="phones"]')).toHaveText(
      "PHONES WATCH FROM THE BACK OF THE ROOM",
      { timeout: HYDRATION_WAIT },
    );
    await expect(roll(page).getByRole("listitem")).toHaveCount(2);
    await expect(startButton(page)).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(roll(host).getByRole("listitem")).toHaveCount(2);
    await expectPhoneFit(page);
    await expectNoA11yViolations(page);

    // START moves the phone to the race page's phone screen
    await expect(startButton(host)).toBeEnabled({ timeout: scaled(20_000) });
    await warmRace(host, lobbyId);
    await startButton(host).click();
    await page.waitForURL(/\/race\/[0-9a-f-]{36}$/, { timeout: HYDRATION_WAIT });
    await expect(phone.kicker(page)).toHaveText("SPECTATOR VIEW", { timeout: HYDRATION_WAIT });
    await expect(phone.state(page)).toHaveAttribute(
      "data-projector-state",
      /^(loading|countdown|racing)$/,
      { timeout: LOAD_LIMIT_MS + scaled(15_000) },
    );
    await expectNoDesk(page);
    expect(sent.filter((f) => f.startsWith('42["keys"') || f.startsWith('42["ready"'))).toEqual([]);
  });
});
