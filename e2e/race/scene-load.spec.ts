import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #695 C4 and C5 (ADR 0013 fallback below Low, ADR 0017 shared main thread, bible 12): on a
// CPU-starved browser (CDP `Emulation.setCPUThrottlingRate`, SCENE_E2E_THROTTLE, default 8) the seat
// scene must never cost the player the race: keystroke batches leave on time while the scene is up, the
// scene falls back to the paper backdrop with the `no-scene` notice once its frame budget is blown (C2),
// and the `auto` benchmark falls back before the scene is ever ready (C5). Control: unthrottled, `low`
// keeps the scene. `@scene` (e2e/fixtures.ts keeps the scene off elsewhere), desktop project only,
// software WebGL as in scene.spec.ts, every deadline through e2e/timeouts.ts.

const THROTTLE = Number(process.env.SCENE_E2E_THROTTLE ?? 8) || 8;
const TYPED = 40;
/** 8 keys a second. */
const KEY_GAP_MS = 125;

type Frame = { t: number; payload: string };
const keysFrames = (frames: Frame[]) => frames.filter((f) => f.payload.startsWith('42["keys",'));
const batchOf = (f: Frame) =>
  (JSON.parse(f.payload.slice(2)) as [string, { batch: { t: number; key: string }[] }])[1].batch;
const keyName = (ch: string) => (ch === " " ? "Space" : ch);

const notice = (page: Page) => page.locator('[data-seat-scene] [data-notice="no-scene"]');
const scene = (page: Page) => page.locator("[data-scene]");
const done = (page: Page) => page.locator('[data-sheet] [data-state="done"]');
const asleep = (page: Page) => page.locator('[data-race-card] [data-you][data-status="asleep"]');

test.describe("#695 the seat scene never starves input", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser (fallback.spec.ts covers that path)");
    // `[data-scene="ready"]` seen at any time, for the "never ready" checks
    await page.addInitScript(() => {
      const w = window as unknown as { __sceneReady?: boolean };
      new MutationObserver(() => {
        if (document.querySelector('[data-scene="ready"]')) w.__sceneReady = true;
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
  });

  /** Throttles the page's renderer (its same-origin scene frame included) before anything loads. */
  async function throttle(page: Page, rate = THROTTLE) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }

  /** Host + one simulated desk; the page takes a desk at `/race/<lobbyId><query>` and records its frames. */
  async function seat(page: Page, browser: Browser, query: string) {
    const room = await hostRoom(browser, opened);
    players = await simulatedPlayers(1, room.lobbyId);
    await warmRace(room.host, room.lobbyId);
    const sent: Frame[] = [];
    page.on("websocket", (ws) =>
      ws.on("framesent", ({ payload }) => sent.push({ t: Date.now(), payload: String(payload) })),
    );
    await page.goto(`/race/${room.lobbyId}${query}`);
    await expect(page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" })).toBeVisible({
      timeout: scaled(60_000),
    });
    await expect(startButton(room.host)).toBeEnabled({ timeout: scaled(20_000) });
    return { ...room, sent };
  }

  /** START on the host; resolves at GO on the page (its `running` phase), with this machine's clock. */
  async function go(page: Page, host: Page): Promise<number> {
    await startButton(host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(30_000),
    });
    return Date.now();
  }

  async function raceText(page: Page): Promise<string[]> {
    return Array.from((await page.locator("[data-telex] [data-state]").allTextContents()).join(""));
  }

  test("C4 under CPU throttling: keys leave on time, the blown frame budget falls back to paper, the desk never sleeps", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(300_000));
    await throttle(page);
    const room = await seat(page, browser, "?preset=high");
    const goAt = await go(page, room.host);
    const chars = (await raceText(page)).slice(0, TYPED);
    expect(chars).toHaveLength(TYPED);

    // (a) 40 characters at 8 keys a second; the desk is watched all along
    let firstPressAt = 0;
    let sleptAt: number | null = null;
    for (const [i, ch] of chars.entries()) {
      const before = Date.now();
      if (i === 0) firstPressAt = before;
      await page.keyboard.press(keyName(ch));
      if (sleptAt === null && (await asleep(page).count()) > 0) sleptAt = Date.now() - goAt;
      const rest = KEY_GAP_MS - (Date.now() - before);
      if (rest > 0) await page.waitForTimeout(rest);
    }
    const typingEnd = Date.now();
    // the sheet follows every key (all correct)
    await expect(done(page)).toHaveCount(TYPED, { timeout: scaled(15_000) });
    await expect
      .poll(() => keysFrames(room.sent).flatMap(batchOf).length, { timeout: scaled(10_000) })
      .toBe(TYPED);

    const frames = keysFrames(room.sent);
    expect(
      frames[0]!.t - firstPressAt,
      "first keys frame after the first press (ms)",
    ).toBeLessThanOrEqual(1_000);
    const gaps = frames
      .filter((f) => f.t <= typingEnd)
      .map((f, i, all) => (i === 0 ? 0 : f.t - all[i - 1]!.t));
    expect(
      Math.max(...gaps),
      "largest gap between keys frames while typing (ms)",
    ).toBeLessThanOrEqual(1_500);
    expect(
      frames.flatMap(batchOf).map((k) => k.key),
      "every typed key in a keys frame, in order",
    ).toEqual(chars);
    expect(sleptAt, "the desk shows ASLEEP").toBeNull();
    await expect(asleep(page)).toHaveCount(0);

    // (b) the scene fell back by 15 s after GO: one notice in the scene slot, none in the live status
    await expect(notice(page)).toHaveCount(1, { timeout: Math.max(1, goAt + 15_000 - Date.now()) });
    await expect(scene(page)).toHaveCount(0);
    await expect(page.locator('[data-notice="no-scene"]')).toHaveCount(1);
    await expect(page.locator('[data-seat-status] [data-notice="no-scene"]')).toHaveCount(0);
    expect(
      page.frames().some((f) => f.url().includes("/3d/seat.html")),
      "the frame is gone",
    ).toBe(false);
  });

  test("C4 (b) the fallback lands within 15 s of GO while the sheet keeps following the keys", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(300_000));
    await throttle(page);
    const room = await seat(page, browser, "?preset=high");
    const goAt = await go(page, room.host);
    const chars = (await raceText(page)).slice(0, TYPED);
    let typed = 0;
    let fallbackAt: number | null = null;
    while (Date.now() - goAt < 15_000 && typed < TYPED) {
      const before = Date.now();
      await page.keyboard.press(keyName(chars[typed]!));
      typed++;
      if (
        fallbackAt === null &&
        (await notice(page).count()) === 1 &&
        (await scene(page).count()) === 0
      ) {
        fallbackAt = Date.now() - goAt;
      }
      const rest = KEY_GAP_MS - (Date.now() - before);
      if (rest > 0) await page.waitForTimeout(rest);
    }
    if (fallbackAt === null) {
      await expect(notice(page)).toHaveCount(1, {
        timeout: Math.max(1, goAt + 15_000 - Date.now()),
      });
      await expect(scene(page)).toHaveCount(0, { timeout: 1 });
      fallbackAt = Date.now() - goAt;
    }
    expect(fallbackAt, "ms from GO to the paper fallback").toBeLessThanOrEqual(15_000);
    await expect(done(page)).toHaveCount(typed, { timeout: scaled(10_000) });
    // a later telemetry or fallback never brings a second notice
    await page.waitForTimeout(2_000);
    await expect(notice(page)).toHaveCount(1);
    await expect(page.locator('[data-notice="no-scene"]')).toHaveCount(1);
  });

  test("C4 (c) control: unthrottled with ?preset=low the scene stays ready, no notice for 10 s after GO", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(180_000));
    const room = await seat(page, browser, "?preset=low");
    await expect(scene(page)).toHaveAttribute("data-scene", "ready", { timeout: scaled(60_000) });
    const goAt = await go(page, room.host);
    while (Date.now() - goAt < 10_000) {
      await expect(scene(page)).toHaveAttribute("data-scene", "ready");
      await expect(page.locator('[data-notice="no-scene"]')).toHaveCount(0);
      await page.waitForTimeout(500);
    }
  });

  test("C5 the auto benchmark under throttling falls back before the scene is ever ready", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(240_000));
    await throttle(page);
    await seat(page, browser, "");
    await expect(notice(page)).toHaveCount(1, { timeout: scaled(90_000) });
    await expect(scene(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __sceneReady?: boolean }).__sceneReady ?? false,
      ),
      "a [data-scene=ready] was seen",
    ).toBe(false);
  });
});
