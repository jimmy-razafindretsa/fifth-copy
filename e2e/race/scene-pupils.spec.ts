import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";

// Contract of #938 C1-C3 (bible 10.1 budgets, 11.3 seat POV, 12 presets): every clerk the seat scene draws
// shows its pupils on every preset, the reduced-detail (LOD1) clerks included, at the same draw calls per
// frame. Opens `/3d/seat.html` top-level (as e2e/race/scene-seating.spec.ts: `parent === window`, so the
// page's own messages pass the origin and source checks), drives it with `fc-race-init` / `fc-race-state`
// and reads what the page reports on `<html>`: `data-pupils="<a>/<b>"` (a = drawn clerks whose pupils are
// drawn, b = drawn clerks) and `data-calls` (the renderer's draw calls per frame, refreshed every second).
// `@scene`, desktop project only (software WebGL), every wait through e2e/timeouts.ts.

const SCENE_WAIT = scaled(60_000);

/** A room of `n` desks numbered 1..n, you at desk 1, waiting. */
const room = (n: number) => ({
  self: 1,
  desks: Array.from({ length: n }, (_, k) => ({
    desk: k + 1,
    tint: "desk-color-1",
    status: "typing",
    rank: null,
    progress: 0,
  })),
  lamp: null,
  phase: "waiting",
});

async function post(page: Page, msg: Record<string, unknown>) {
  await page.evaluate((m) => postMessage({ v: 1, ...m }, location.origin), msg);
}

const html = (page: Page) => page.locator("html");

/** `data-pupils` as [a, b], or null before the page has reported it. */
async function pupils(page: Page): Promise<[number, number] | null> {
  const raw = await html(page).getAttribute("data-pupils");
  const m = raw ? /^(\d+)\/(\d+)$/.exec(raw) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function open(page: Page, preset: string, n: number) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/3d/seat.html?preset=${preset}`);
  await post(page, { type: "fc-race-init", view: room(n), preset, motion: "full" });
  await expect(html(page)).toHaveAttribute("data-room", "ready", { timeout: SCENE_WAIT });
  await expect(html(page)).toHaveAttribute("data-seats", String(n), { timeout: SCENE_WAIT });
}

/** Every drawn clerk shows its pupils: a equals b, and b is the expected count of drawn clerks. */
async function expectAllPupils(page: Page, drawn: number) {
  await expect
    .poll(() => pupils(page), { timeout: SCENE_WAIT, message: `pupils of ${drawn} clerks` })
    .toEqual([drawn, drawn]);
}

test.describe("#938 every clerk keeps its pupils on every preset", { tag: "@scene" }, () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
  test.slow();

  test.beforeEach(async ({ page }) => {
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL2 in this browser");
  });

  test("C1 on LOW, every clerk shows pupils from the seat and from the overview", async ({
    page,
  }) => {
    // seat POV: your own clerk is hidden, 29 drawn, most of them past the nearest 6 (reduced detail)
    await open(page, "low", 30);
    await expectAllPupils(page, 29);
    // the overview camera draws every clerk, 24 of them at reduced detail
    await post(page, {
      type: "fc-race-init",
      view: room(30),
      preset: "low",
      motion: "full",
      camera: "over",
    });
    await expect(html(page)).toHaveAttribute("data-layout", "even", { timeout: SCENE_WAIT });
    await expectAllPupils(page, 30);
  });

  test("C2 on LOW, 30 clerks cost the draw calls of 6 at full detail, AA stays off", async ({
    page,
  }) => {
    const calls = async () => Number((await html(page).getAttribute("data-calls")) ?? NaN);
    const fresh = async () => {
      // the page refreshes the reading every second: drop the old one and wait for the next
      await page.evaluate(() => document.documentElement.removeAttribute("data-calls"));
      await expect.poll(calls, { timeout: SCENE_WAIT }).toBeGreaterThan(0);
      return calls();
    };
    await open(page, "low", 6);
    await expectAllPupils(page, 5);
    const six = await fresh();
    await post(page, { type: "fc-race-state", view: room(30) });
    await expect(html(page)).toHaveAttribute("data-seats", "30", { timeout: SCENE_WAIT });
    await expectAllPupils(page, 29);
    expect(await fresh(), "draw calls in a room of 30 vs a room of 6").toBe(six);

    const embed = readFileSync("public/3d/seat.html", "utf8");
    expect(embed, "LOW keeps antialiasing off").toMatch(
      /low:\s*\{\s*pr:\s*1,\s*near:\s*6,\s*aa:\s*false\s*\}/,
    );
  });

  for (const preset of ["medium", "high"]) {
    test(`C3 on ${preset.toUpperCase()}, every drawn clerk shows pupils from the seat`, async ({
      page,
    }) => {
      await open(page, preset, 30);
      await expectAllPupils(page, 29);
    });
  }
});
