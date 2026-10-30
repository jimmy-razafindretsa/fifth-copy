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

// Contract of #695 C2, C4, C5, C8 (ADR 0013 fallback below Low, ADR 0017 shared main thread, bible 12,
// 7.4, 14.3): the seat scene never costs the player the race. The `auto` benchmark is a fixed probe drawn
// before any of the room exists (owner DECISION "Benchmark avant la salle"), on the visible layer (never
// transparent or hidden while loading, behind the loading card); on software WebGL (SwiftShader) it reads
// under PROBE_MIN_FPS and falls back to paper without the room ever being built (`data-room` stays `none`),
// also under CPU throttling (CDP `Emulation.setCPUThrottlingRate`, SCENE_E2E_THROTTLE, default 8), where
// the notice is up within 5 s of GO and GO and the keystroke batches stay on time. A forced `?preset=low` scene blows its frame budget at runtime;
// the `?scene=pin` control (C9) keeps it and input stays on time. `@scene` (e2e/fixtures.ts keeps the
// scene off elsewhere), desktop project only, every test wait through e2e/timeouts.ts (the 1500 ms input
// limits are the contract's, not test waits).

const THROTTLE = Number(process.env.SCENE_E2E_THROTTLE ?? 8) || 8;
const TYPED = 40;
/** 8 keys a second. */
const KEY_GAP_MS = 125;
/** The contract's input limits: first `keys` frame after the first press, largest gap while typing. */
const FIRST_FRAME_MS = 1_500;
const MAX_GAP_MS = 1_500;

type Frame = { t: number; payload: string };
const keysFrames = (frames: Frame[]) => frames.filter((f) => f.payload.startsWith('42["keys",'));
const batchOf = (f: Frame) =>
  (JSON.parse(f.payload.slice(2)) as [string, { batch: { t: number; key: string }[] }])[1].batch;
const keyName = (ch: string) => (ch === " " ? "Space" : ch);

const slotNotice = (page: Page) => page.locator('[data-seat-scene] [data-notice="no-scene"]');
const anyNotice = (page: Page) => page.locator('[data-notice="no-scene"]');
const statusNotice = (page: Page) => page.locator('[data-seat-status] [data-notice="no-scene"]');
const scene = (page: Page) => page.locator("[data-scene]");
const done = (page: Page) => page.locator('[data-sheet] [data-state="done"]');
const asleep = (page: Page) => page.locator('[data-race-card] [data-you][data-status="asleep"]');
const hasSeatFrame = (page: Page) => page.frames().some((f) => f.url().includes("/3d/seat.html"));

/** What the init script saw of the scene layer, from the first paint on. */
type Seen = {
  loading: boolean;
  ready: boolean;
  /** `Date.now()` when the layer first read `ready` (same machine clock as the test). */
  readyAt: number | null;
  budget: string | null;
  presets: string[];
  /** Computed styles of a loading layer that was not drawn, or a loading layer without its card. */
  hidden: string[];
  /** The frame's `data-bench` (`probe:<fps>`, then the settled preset on a passing device). */
  bench: string | null;
  /** Every value the frame's `data-room` took (`none`, `building`, `ready`), in order. */
  rooms: string[];
  /** `Date.now()` when the page first showed paper: one slot notice, none in the status, no scene layer. */
  paperAt: number | null;
  /**
   * State changes since the page's first script (scene, preset, phase, notices) and every main-thread
   * frame longer than 300 ms (a drawn scene frame, a build slice, the page's own work), for failure output.
   */
  log: string[];
};
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen }).__seen);

test.describe("#695 the seat scene never starves input", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  /** `keys` frames sent while typing, ms after the first press (failure output). */
  let keysSent = "";
  test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus) {
      const log = await seen(page)
        .then((x) =>
          [
            ...x.log,
            `bench ${x.bench} room ${x.rooms.join(">")}`,
            `keys frames ${keysSent || "-"}`,
          ].join("\n"),
        )
        .catch(() => "no timeline");
      keysSent = "";
      await info.attach("scene timeline", { body: log, contentType: "text/plain" });
      console.log(`[${info.title}] scene timeline\n${log}`);
    }
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser (fallback.spec.ts covers that path)");
    // C8: every state of the scene layer, seen as it happens (the page) and the embed's ladder (the frame)
    await page.addInitScript(() => {
      type W = { __seen?: Seen };
      if (window !== window.top) {
        // the seat frame (same origin): hand its `data-bench` and every `data-room` to the page
        new MutationObserver(() => {
          const { bench, room } = document.documentElement?.dataset ?? {};
          const top = (window.top as unknown as W | null)?.__seen;
          if (!top) return;
          if (bench) top.bench = bench;
          if (room && top.rooms.at(-1) !== room) top.rooms.push(room);
        }).observe(document, {
          subtree: true,
          attributes: true,
          attributeFilter: ["data-bench", "data-room"],
        });
        return;
      }
      const s: Seen = {
        loading: false,
        ready: false,
        readyAt: null,
        budget: null,
        presets: [],
        hidden: [],
        bench: null,
        rooms: [],
        paperAt: null,
        log: [],
      };
      const t0 = Date.now();
      let last = "";
      (window as unknown as W).__seen = s;
      const look = () => {
        const layer = document.querySelector<HTMLElement>("[data-scene]");
        const phase = document
          .querySelector("[data-seat-status] [data-phase]")
          ?.getAttribute("data-phase");
        const notices = document.querySelectorAll('[data-notice="no-scene"]').length;
        const now = `scene=${layer?.dataset.scene ?? "none"} preset=${layer?.dataset.scenePreset ?? "-"} phase=${phase ?? "-"} notices=${notices}`;
        if (now !== last) s.log.push(`+${Date.now() - t0}ms ${(last = now)}`);
        const slot = document.querySelectorAll('[data-seat-scene] [data-notice="no-scene"]').length;
        const status = document.querySelectorAll(
          '[data-seat-status] [data-notice="no-scene"]',
        ).length;
        if (s.paperAt === null && !layer && slot === 1 && notices === 1 && status === 0)
          s.paperAt = Date.now();
        if (!layer) return;
        const preset = layer.dataset.scenePreset;
        if (preset && !s.presets.includes(preset)) s.presets.push(preset);
        s.budget ??= layer.dataset.sceneBudget ?? null;
        if (layer.dataset.scene === "ready" && !s.ready) {
          s.ready = true;
          s.readyAt = Date.now();
        }
        if (layer.dataset.scene !== "loading") return;
        s.loading = true;
        const { opacity, visibility } = getComputedStyle(layer);
        if (opacity !== "1" || visibility !== "visible")
          s.hidden.push(`opacity ${opacity}, visibility ${visibility}`);
        const card = document.querySelector<HTMLElement>("[data-loading-card]");
        const box = card?.getBoundingClientRect();
        if (!card || !box || box.width === 0 || box.height === 0) s.hidden.push("no loading card");
      };
      // long main-thread frames (the scene's and the page's: one thread, ADR 0017), as they happen
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { renderStart: number })[]) {
            if (e.duration < 300) continue;
            const at = Math.round(performance.timeOrigin + e.startTime - t0);
            const render = e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : 0;
            s.log.push(`+${at}ms long frame ${Math.round(e.duration)}ms (render ${render}ms)`);
          }
        }).observe({ type: "long-animation-frame", buffered: true });
      } catch {
        // no Long Animation Frames API: the timeline keeps the state changes only
      }
      new MutationObserver(look).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "data-scene",
          "data-scene-preset",
          "data-scene-budget",
          "data-phase",
          "data-notice",
        ],
      });
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

  /** START on the host; resolves at GO on the page (its `running` phase) within scaled(10 s). */
  async function go(page: Page, host: Page): Promise<number> {
    await startButton(host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(10_000),
    });
    return Date.now();
  }

  async function raceText(page: Page): Promise<string[]> {
    return Array.from((await page.locator("[data-telex] [data-state]").allTextContents()).join(""));
  }

  /**
   * "Input on time" (C4): 40 characters of the text from GO at 8 keys a second with `keyboard.press`;
   * every key in a `keys` frame, in order; the first frame within 1500 ms of the first press; no two
   * consecutive frames more than 1500 ms apart while typing; 40 `done` cells; the desk never asleep.
   */
  async function inputOnTime(page: Page, sent: Frame[], onKey?: () => Promise<void>) {
    const chars = (await raceText(page)).slice(0, TYPED);
    expect(chars).toHaveLength(TYPED);
    let firstPressAt = 0;
    let slept = false;
    for (const [i, ch] of chars.entries()) {
      const before = Date.now();
      if (i === 0) firstPressAt = before;
      await page.keyboard.press(keyName(ch));
      if (!slept && (await asleep(page).count()) > 0) slept = true;
      await onKey?.();
      const rest = KEY_GAP_MS - (Date.now() - before);
      if (rest > 0) await page.waitForTimeout(rest);
    }
    const typingEnd = Date.now();
    await expect
      .poll(() => keysFrames(sent).flatMap(batchOf).length, { timeout: scaled(10_000) })
      .toBe(TYPED);

    const frames = keysFrames(sent);
    keysSent = frames.map((f) => f.t - firstPressAt).join(" ");
    expect(frames[0]!.t - firstPressAt, "first keys frame after the first press (ms)").toBeLessThan(
      FIRST_FRAME_MS + 1,
    );
    const typing = frames.filter((f) => f.t <= typingEnd);
    const gaps = typing.slice(1).map((f, i) => f.t - typing[i]!.t);
    expect(Math.max(0, ...gaps), "largest gap between keys frames while typing (ms)").toBeLessThan(
      MAX_GAP_MS + 1,
    );
    expect(
      frames.flatMap(batchOf).map((k) => k.key),
      "every typed key in a keys frame, in order",
    ).toEqual(chars);
    await expect(done(page)).toHaveCount(TYPED, { timeout: scaled(15_000) });
    expect(slept, "the desk showed ASLEEP").toBe(false);
    await expect(asleep(page)).toHaveCount(0);
  }

  /** The paper fallback: one notice, in the scene slot, never in the live status; no scene, no frame. */
  async function onPaper(page: Page, timeout: number) {
    await expect(slotNotice(page)).toHaveCount(1, { timeout: Math.max(1, timeout) });
    await expect(anyNotice(page)).toHaveCount(1);
    await expect(statusNotice(page)).toHaveCount(0);
    await expect(scene(page)).toHaveCount(0);
    expect(hasSeatFrame(page), "the /3d/seat.html frame is gone").toBe(false);
  }

  /**
   * C8 on software WebGL: the layer drawn while loading, never ready, one probe reading in `data-bench`
   * and no preset settled, the room never built (`data-room` only ever `none`).
   */
  async function probeFellBack(page: Page) {
    const s = await seen(page);
    expect(s.loading, "the loading layer was seen").toBe(true);
    expect(s.hidden, "the loading layer is drawn (opacity 1, visible) under its card").toEqual([]);
    expect(s.ready, 'a [data-scene="ready"] was seen').toBe(false);
    expect(s.presets, "a data-scene-preset was reported").toEqual([]);
    expect(s.bench, "data-bench: exactly one probe reading").toMatch(/^probe:\d+$/);
    expect(s.rooms, "data-room never left none").toEqual(["none"]);
  }

  test("C4 (a) C8 throttled auto: the probe sends the page to paper before the room exists; GO and input on time", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(300_000));
    await throttle(page);
    const room = await seat(page, browser, "");
    const goAt = await go(page, room.host);
    // the notice within 5 s of GO (the observer saw it as it happened: typing starts at GO meanwhile)
    const paper = (async () => {
      await onPaper(page, goAt + scaled(5_000) - Date.now());
      return (await seen(page)).paperAt;
    })();
    paper.catch(() => {}); // awaited below; a miss fails there, after the typing
    await inputOnTime(page, room.sent);
    const paperAt = await paper;
    expect(paperAt, "paper (one slot notice, no scene) was seen").not.toBeNull();
    expect(paperAt! - goAt, "paper after GO (ms)").toBeLessThanOrEqual(scaled(5_000));

    await onPaper(page, 1);
    await page.waitForTimeout(2_000);
    await expect(anyNotice(page)).toHaveCount(1);
    await probeFellBack(page);
  });

  test("C8 unthrottled auto: the probe is drawn under the loading card and falls back, the room never built", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(180_000));
    await seat(page, browser, "");
    await onPaper(page, scaled(60_000));
    await page.waitForTimeout(2_000);
    await expect(anyNotice(page)).toHaveCount(1);
    await probeFellBack(page);
  });

  test("C4 (b) C2 runtime budget: a forced ?preset=low scene under 18 fps falls back within 15 s of ready, the race goes on", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(240_000));
    const room = await seat(page, browser, "?preset=low");
    // ready first (the fallback may follow within seconds: the init script saw it as it happened)
    await expect.poll(async () => (await seen(page)).ready, { timeout: scaled(60_000) }).toBe(true);
    const { readyAt, budget, bench } = await seen(page);
    expect(budget, "data-scene-budget").toBe("on");
    expect(bench, "a forced preset runs no probe (data-bench empty)").toBeNull();
    await go(page, room.host);
    const chars = (await raceText(page)).slice(0, TYPED);

    // keys pressed meanwhile: until the fallback (or 15 s after ready), and at least eight after GO
    let typed = 0;
    const scenePending = async () =>
      (await scene(page).count()) > 0 && Date.now() - readyAt! < scaled(15_000);
    while (typed < TYPED && (typed < 8 || (await scenePending()))) {
      const before = Date.now();
      await page.keyboard.press(keyName(chars[typed]!));
      typed++;
      const rest = KEY_GAP_MS - (Date.now() - before);
      if (rest > 0) await page.waitForTimeout(rest);
    }
    await onPaper(page, readyAt! + scaled(15_000) - Date.now());
    await expect(page.locator("[data-race-card]")).toBeVisible();
    await expect(done(page)).toHaveCount(typed, { timeout: scaled(10_000) });
    // a later telemetry or fallback never brings a second notice
    await page.waitForTimeout(2_000);
    await expect(anyNotice(page)).toHaveCount(1);
    await expect(statusNotice(page)).toHaveCount(0);
  });

  test("C4 (c) C9 control: ?scene=pin keeps the scene at LOW with the budget off; GO and input on time", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(240_000));
    const room = await seat(page, browser, "?scene=pin");
    await expect(scene(page)).toHaveAttribute("data-scene", "ready", { timeout: scaled(60_000) });
    await expect(scene(page)).toHaveAttribute("data-scene-preset", "low");
    await expect(scene(page)).toHaveAttribute("data-scene-budget", "off");
    await go(page, room.host);
    await expect(scene(page), "the scene is mounted when typing starts").toHaveCount(1);
    await inputOnTime(page, room.sent);
  });
});
