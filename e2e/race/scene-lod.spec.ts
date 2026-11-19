import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";

// Contract of #940 C1-C2 (bible 12 presets: LOD0 seats nearest 6 / 12 / all, ADR 0013 draw-call budget):
// the full-detail (LOD0) places of a preset go to the nearest clerks the seat scene actually draws; empty
// desks and your own clerk, hidden at POV, take none of them. Opens `/3d/seat.html` top-level (as
// e2e/race/scene-pupils.spec.ts: `parent === window`, so the page's own messages pass the origin and source
// checks), drives it with `fc-race-init` / `fc-race-state` and reads what the page reports on `<html>`:
// `data-lod0="<a>/<b>"` (a = drawn clerks at LOD0, b = drawn clerks) and `data-calls` (the renderer's draw
// calls per frame, refreshed every second). `@scene`, desktop project only (software WebGL), every wait
// through e2e/timeouts.ts. #999 C65 adds the sabotage throws' budget (bible 10.2 "Sabotage throw"): pooled
// instanced meshes, so a Smoke Break on 29 desks keeps the frame at most 60 draw calls, with at most 8
// objects in flight (`data-throws-flying`, `-peak`) and the others landing directly; it reads the per-play
// facts `data-throws-puffs-total`, `-puffs-peak` and `-calls-peak` (bible 10.2 "Report").

const SCENE_WAIT = scaled(60_000);

/** A room of `n` desks numbered 1..n, you at desk 1, waiting. */
const room = (n: number, phase = "waiting") => ({
  self: 1,
  desks: Array.from({ length: n }, (_, k) => ({
    desk: k + 1,
    tint: "desk-color-1",
    status: "typing",
    rank: null,
    progress: 0,
  })),
  lamp: null,
  phase,
});

async function post(page: Page, msg: Record<string, unknown>) {
  await page.evaluate((m) => postMessage({ v: 2, ...m }, location.origin), msg);
}

const html = (page: Page) => page.locator("html");

async function open(page: Page, n: number, motion = "full", phase = "waiting") {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/3d/seat.html?preset=low");
  await post(page, { type: "fc-race-init", view: room(n, phase), preset: "low", motion });
  await expect(html(page)).toHaveAttribute("data-room", "ready", { timeout: SCENE_WAIT });
  await expect(html(page)).toHaveAttribute("data-seats", String(n), { timeout: SCENE_WAIT });
}

/** `data-lod0` reaches `<a>/<b>`: a drawn clerks at full detail out of b drawn clerks. */
async function expectLod0(page: Page, a: number, b: number) {
  await expect(html(page)).toHaveAttribute("data-lod0", `${a}/${b}`, { timeout: SCENE_WAIT });
}

test.describe("#940 LOD0 places go to drawn clerks only", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser");
  });

  test("C1 on LOW at POV in a room of 6, all 5 rivals are at full detail", async ({ page }) => {
    await open(page, 6);
    await expectLod0(page, 5, 5);
  });

  test("C2 on LOW at POV in a room of 30, 6 of 29 at full detail, draw calls of a room of 6", async ({
    page,
  }) => {
    const calls = async () => Number((await html(page).getAttribute("data-calls")) ?? NaN);
    const fresh = async () => {
      // the page refreshes the reading every second: drop the old one and wait for the next
      await page.evaluate(() => document.documentElement.removeAttribute("data-calls"));
      await expect.poll(calls, { timeout: SCENE_WAIT }).toBeGreaterThan(0);
      return calls();
    };
    // reduced motion: the Major stands still, so no random smoke puff, pour or glass liquid adds a draw call
    // of its own between two readings (bible 8); only the clerks' share can differ between the two rooms
    await open(page, 6, "reduce");
    await expect(html(page)).toHaveAttribute("data-motion", "reduce");
    await expectLod0(page, 5, 5);
    const six = await fresh();
    await post(page, { type: "fc-race-state", view: room(30) });
    await expect(html(page)).toHaveAttribute("data-seats", "30", { timeout: SCENE_WAIT });
    await expectLod0(page, 6, 29);
    expect(await fresh(), "draw calls in a room of 30 vs a room of 6").toBe(six);
  });

  test("#999 C65 a Smoke Break on 29 desks: at most 8 objects in flight, the rest land directly, at most 60 draw calls, all gone at race end", async ({
    page,
  }) => {
    const num = async (name: string) =>
      Number((await html(page).getAttribute(`data-${name}`)) ?? NaN);
    await open(page, 30, "full", "running");
    await post(page, {
      type: "fc-race-sabotage",
      kind: "smoke-break",
      from: 30,
      to: Array.from({ length: 29 }, (_, k) => k + 1),
    });
    // a puff lives 1 s of wall time and a software-WebGL frame can take longer, so the test reads the
    // facts the page keeps since the play (peaks and totals), never a short-lived state between two readings:
    // every ball bursts into a puff (8 after their flight, the rest landing directly), more than 8 of them in
    // one frame, still one draw, and no frame that drew a thrown object or a puff went over 60 draw calls
    await expect(html(page)).toHaveAttribute("data-throws-puffs-total", "29", {
      timeout: SCENE_WAIT,
    });
    await expect(html(page)).toHaveAttribute("data-throws-puffs", "0", { timeout: SCENE_WAIT });
    expect(await num("throws-peak"), "most in flight at once").toBe(8);
    expect(await num("throws-puffs-peak"), "most puffs in one frame").toBeGreaterThan(8);
    const callsPeak = await num("throws-calls-peak");
    expect(callsPeak, "draw calls of a frame with throws").toBeGreaterThan(0);
    expect(callsPeak, "draw calls of a frame with throws").toBeLessThanOrEqual(60);
    // clutter from the other kinds goes at race end
    await post(page, { type: "fc-race-sabotage", kind: "extra-paperwork", from: 3, to: [1] });
    await post(page, { type: "fc-race-sabotage", kind: "exemption", from: 7, to: [7] });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "2", { timeout: SCENE_WAIT });
    await post(page, { type: "fc-race-state", view: room(30, "ended") });
    await expect(html(page)).toHaveAttribute("data-throws-landed", "0", { timeout: SCENE_WAIT });
    await expect(html(page)).toHaveAttribute("data-throws-flying", "0");
  });
});
