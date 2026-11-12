import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";

// Contract of #912 C1, C2, C3 (bible 12 Benchmark, ADR 0013 fallback below Low, ADR 0017 Amendments): the
// `auto` probe of `/3d/seat.html` on software WebGL (SwiftShader). The page is opened top-level, so
// `parent === window`: `fc-race-init` posted from the page itself passes its origin and source checks, and
// its replies (`send`) go nowhere; the verdict is read from `data-bench` and every value `data-room` takes.
// C1: one 500 ms main-thread task inside the probe's first 0.5 s window (the race page shares the frame's
// thread) no longer fails a device that passes without it. C2 / C3: at 1280×800 and 1920×1080 the reading
// stays under PROBE_MIN_FPS (5) and the room is never built; the quads are drawn into at most
// PROBE_MAX_PIXELS of the buffer (same aspect) while the clear covers the whole canvas. `@scene`, desktop
// project only, every test wait through e2e/timeouts.ts.

const PROBE_MIN_FPS = 5;
const PROBE_MAX_PIXELS = 1_024_000;
/** One main-thread busy task, as on the race page that shares the frame's thread (ADR 0017). */
const STALL_MS = 500;
/** When the busy task starts after `fc-race-init`: inside the 0.5 s window, after the probe's first frames. */
const STALL_AFTER_MS = 60;

type Probe = { rooms: string[]; quads: string[]; clears: string[] };

/** Records every `data-room` value and the viewport of every probe draw and clear (C3). */
function instrument() {
  const w = window as unknown as { __probe: Probe };
  w.__probe = { rooms: [], quads: [], clears: [] };
  const seen = (list: string[], v: string) => {
    if (list[list.length - 1] !== v) list.push(v);
  };
  new MutationObserver(() => {
    const room = document.documentElement.dataset.room;
    if (room) seen(w.__probe.rooms, room);
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-room"] });
  const proto = WebGL2RenderingContext.prototype;
  const vp = (gl: WebGL2RenderingContext) => {
    const [, , width, height] = gl.getParameter(gl.VIEWPORT) as Int32Array;
    return `${width}x${height}`;
  };
  const clear = proto.clear;
  proto.clear = function (this: WebGL2RenderingContext, mask: number) {
    if (document.documentElement.dataset.room === "none") seen(w.__probe.clears, vp(this));
    return clear.call(this, mask);
  };
  const draw = proto.drawArrays;
  proto.drawArrays = function (this: WebGL2RenderingContext, ...a: Parameters<typeof draw>) {
    if (document.documentElement.dataset.room === "none") seen(w.__probe.quads, vp(this));
    return draw.apply(this, a);
  };
}

async function openSeat(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(instrument);
  await page.goto("/3d/seat.html");
  await expect(page.locator("html")).toHaveAttribute("data-room", "none");
}

/** `fc-race-init` in `auto` from the page itself; with `stall`, one busy task of STALL_MS after STALL_AFTER_MS. */
async function init(page: Page, stall: boolean) {
  await page.evaluate(
    ({ stall, after, ms }) => {
      postMessage(
        { v: 1, type: "fc-race-init", view: {}, preset: "auto", motion: "full" },
        location.origin,
      );
      if (stall)
        setTimeout(() => {
          const until = performance.now() + ms;
          while (performance.now() < until);
        }, after);
    },
    { stall, after: STALL_AFTER_MS, ms: STALL_MS },
  );
}

const bench = (page: Page) => page.evaluate(() => document.documentElement.dataset.bench ?? null);
const probeOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);
const reading = (b: string) => Number(/^probe:(\d+)/.exec(b)?.[1]);

test.describe(
  "#912 the auto probe judges the device, not a stall or the window size",
  { tag: "@scene" },
  () => {
    test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");

    test.beforeEach(async ({ page }) => {
      const webgl = await page.evaluate(
        () => !!document.createElement("canvas").getContext("webgl2"),
      );
      test.skip(!webgl, "no WebGL2 in this browser");
    });

    /** A passing verdict: a reading at or above the floor, a settled preset, and the room leaving `none`. */
    async function passes(page: Page) {
      await expect
        .poll(() => bench(page), { timeout: scaled(10_000) })
        .toMatch(/^probe:\d+ (low|medium|high)$/);
      const b = (await bench(page))!;
      expect(reading(b), `the probe reading (${b})`).toBeGreaterThanOrEqual(PROBE_MIN_FPS);
      await expect
        .poll(async () => (await probeOf(page)).rooms.some((r) => r !== "none"), {
          timeout: scaled(10_000),
        })
        .toBe(true);
    }

    /** A fallback: one reading under the floor, no preset, `data-room` only ever `none`. */
    async function fallsBack(page: Page) {
      await expect.poll(() => bench(page), { timeout: scaled(20_000) }).toMatch(/^probe:\d+/);
      // the page stops at `benchmark-low`: give a passing verdict the time to show itself if it came
      await page.waitForTimeout(1_000);
      const b = (await bench(page))!;
      expect(b, "data-bench: one probe reading, no preset").toMatch(/^probe:\d+$/);
      expect(reading(b)).toBeLessThan(PROBE_MIN_FPS);
      expect((await probeOf(page)).rooms, "data-room never left none").toEqual(["none"]);
    }

    test("C1 control: 160×100 without a stall passes", async ({ page }) => {
      await openSeat(page, 160, 100);
      await init(page, false);
      await passes(page);
    });

    test("C1: 160×100 with one 500 ms main-thread task in the first window still passes", async ({
      page,
    }) => {
      await openSeat(page, 160, 100);
      await init(page, true);
      await passes(page);
    });

    test("C2: 1280×800 on software WebGL reads under the floor and falls back before the room", async ({
      page,
    }) => {
      await openSeat(page, 1280, 800);
      await init(page, false);
      await fallsBack(page);
    });

    test("C3: 1920×1080 draws the quads into at most 1280×800 (same aspect), clears the canvas, and falls back", async ({
      page,
    }) => {
      await openSeat(page, 1920, 1080);
      await init(page, false);
      await fallsBack(page);
      const { quads, clears } = await probeOf(page);
      expect(clears, "the clear covers the whole canvas").toContain("1920x1080");
      expect(quads.length, "the probe drew").toBeGreaterThan(0);
      for (const q of quads) {
        const [w = 0, h = 1] = q.split("x").map(Number);
        expect(w * h, `quads viewport ${q}`).toBeLessThanOrEqual(PROBE_MAX_PIXELS);
        expect(Math.abs(w / h - 1920 / 1080), `quads viewport ${q} keeps the aspect`).toBeLessThan(
          0.01,
        );
      }
    });
  },
);
