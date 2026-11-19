import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  recordRaceTokens,
  setHostSettings,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #999 C2, C4, C5, C66 (bible 11.3 Overview, 10.3 "Lamp", 14.3 "Projector view", 15
// `fc-scene-anchors`; ADR 0017 SCENE_PROTOCOL 2). Two halves:
// - the embed on its own (C2, C5): `/3d/seat.html` opened top-level (as e2e/race/scene-sabotage.spec.ts),
//   driven with `fc-race-init { camera: "over" }` and a spectator view (`self: null`); it reports on
//   `<html>`: `data-layout` (`even`), `data-fov` (55), `data-orbit` (the orbit angle: moving under full
//   motion, still under reduce), `data-anchors` (on-screen plaque points) and `data-lamp` /
//   `data-lamp-mode` (the leader's desk; `swing`, or `set` under reduce).
// - the projector page (C4, C5, C66): `/race/<id>?view=projector&scene=pin` over a real room (two
//   simulated typists and a recruit bot; the host watches): the overview scene (`data-scene-camera=over`),
//   the HTML rank plaques placed from its anchors, the overtaker's chip flipping (`data-flip`, counted by
//   `data-flips`; none under reduced motion), the embed's lamp on the leader and the bot's Smoke Break
//   acked by the projector's scene (`data-scene-sabotage`), the same mapping as a seat's.
// `@scene`, desktop project only (software WebGL), every wait through e2e/timeouts.ts; run with
// PW_WORKERS=1.

const SCENE_WAIT = scaled(60_000);

const html = (page: Page) => page.locator("html");
const attr = async (page: Page, name: string) => html(page).getAttribute(`data-${name}`);

/** A spectator's running room of `n` desks numbered 1..n, the lamp on `lamp`. */
const room = (n: number, lamp: number | null, phase = "running") => ({
  self: null,
  desks: Array.from({ length: n }, (_, k) => ({
    desk: k + 1,
    tint: "desk-color-1",
    status: "typing",
    rank: k + 1,
    progress: 0,
  })),
  lamp,
  phase,
});

async function post(page: Page, msg: Record<string, unknown>) {
  await page.evaluate((m) => postMessage({ v: 2, ...m }, location.origin), msg);
}

async function openOverview(page: Page, n: number, motion: "full" | "reduce") {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/3d/seat.html?preset=low");
  await post(page, {
    type: "fc-race-init",
    view: room(n, null),
    preset: "low",
    motion,
    camera: "over",
  });
  await expect(html(page)).toHaveAttribute("data-room", "ready", { timeout: SCENE_WAIT });
  await expect(html(page)).toHaveAttribute("data-seats", String(n), { timeout: SCENE_WAIT });
}

async function skipWithoutWebGL(page: Page) {
  const webgl = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  test.skip(!webgl, "no WebGL2 in this browser");
}

test.describe(
  "#999 the overview camera and the Major's lamp, the embed on its own",
  { tag: "@scene" },
  () => {
    test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
    test.slow();
    test.beforeEach(async ({ page }) => skipWithoutWebGL(page));

    test("C2 C4 C5 the orbit spaces every desk evenly at FOV 55, sends anchors, and swings the lamp to the leader", async ({
      page,
    }) => {
      await openOverview(page, 6, "full");
      await expect(html(page)).toHaveAttribute("data-layout", "even");
      await expect(html(page)).toHaveAttribute("data-fov", "55");
      // every desk of a 6-desk room is on screen from the orbit: none hidden behind the Major
      await expect
        .poll(async () => Number(await attr(page, "anchors")), { timeout: SCENE_WAIT })
        .toBe(6);
      // the orbit turns (0.05 rad/s)
      const a0 = Number(await attr(page, "orbit"));
      await expect
        .poll(async () => Number(await attr(page, "orbit")), { timeout: scaled(10_000) })
        .toBeGreaterThan(a0 + 0.02);
      // no lamp before a leader; a leader swings it there
      await expect(html(page)).toHaveAttribute("data-lamp", "none");
      await post(page, { type: "fc-race-state", view: room(6, 4) });
      await expect(html(page)).toHaveAttribute("data-lamp", "4");
      await expect(html(page)).toHaveAttribute("data-lamp-mode", "swing");
      // the race over: it hangs straight down
      await post(page, { type: "fc-race-state", view: room(6, null, "finished") });
      await expect(html(page)).toHaveAttribute("data-lamp", "none");
    });

    test("C2 C5 under reduced motion the camera is still and the lamp is set at once", async ({
      page,
    }) => {
      await openOverview(page, 4, "reduce");
      await expect(html(page)).toHaveAttribute("data-layout", "even");
      const a0 = await attr(page, "orbit");
      expect(a0).not.toBeNull();
      await page.waitForTimeout(scaled(1_500));
      expect(await attr(page, "orbit")).toBe(a0);
      await post(page, { type: "fc-race-state", view: room(4, 2) });
      await expect(html(page)).toHaveAttribute("data-lamp", "2");
      await expect(html(page)).toHaveAttribute("data-lamp-mode", "set");
    });
  },
);

const stage = (page: Page) => page.locator("[data-projector-stage] [data-scene-camera]");
const embed = (page: Page) =>
  page.frameLocator("[data-projector-stage] [data-scene-camera] iframe").locator("html");
const plaque = (page: Page, desk: number) => page.locator(`[data-plaque="${desk}"]`);
const chip = (page: Page, desk: number) => plaque(page, desk).locator("[data-rank]");
const flipsOf = async (page: Page, desk: number) =>
  Number((await chip(page, desk).getAttribute("data-flips")) ?? 0);

test.describe(
  "#999 the projector's overview scene, plaques and lamp over a real room",
  { tag: "@scene" },
  () => {
    test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only (software WebGL)");
    test.slow();

    const opened: BrowserContext[] = [];
    const sims: SimulatedPlayer[] = [];
    test.afterEach(async () => {
      for (const sim of sims.splice(0)) sim.close();
      for (const context of opened.splice(0)) await context.close();
    });
    test.beforeEach(async ({ page }) => skipWithoutWebGL(page));

    test("C4 C5 C66 plaques ride the desks, an overtake flips the chip and swings the lamp (none under reduce), the bot's play reaches the projector's scene", async ({
      page,
      browser,
    }) => {
      test.setTimeout(scaled(240_000));
      const { host, lobbyId } = await hostRoom(browser, opened, {
        before: async (h) => {
          await h.setViewportSize({ width: 1280, height: 800 });
          await recordRaceTokens(h);
        },
      });
      // the host watches: two simulated typists and one recruit bot are the field (3 desks: the bot,
      // last, is dealt a Smoke Break and plays it after BOT_HOLD_MS)
      await setHostSettings(host, {
        hostWatches: true,
        wordCount: 40,
        bots: [{ level: "recruit" }],
      });
      const [a, b] = await simulatedPlayers(2, lobbyId, { names: ["Sim-A", "Sim-B"] });
      sims.push(a!, b!);

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/race/${lobbyId}?view=projector&scene=pin`);
      await expect(stage(page)).toHaveAttribute("data-scene-camera", "over");
      await expect(stage(page)).toHaveAttribute("data-scene", "ready", { timeout: SCENE_WAIT });
      // C4: one plaque per desk, placed from the scene's anchors (visible), with DESK and the name
      await expect(page.locator("[data-plaque]")).toHaveCount(3);
      for (const sim of [a!, b!]) {
        await expect(plaque(page, sim.desk)).toBeVisible({ timeout: SCENE_WAIT });
        await expect(plaque(page, sim.desk)).toContainText(
          `DESK ${String(sim.desk).padStart(2, "0")}`,
        );
        await expect(plaque(page, sim.desk)).toContainText(sim.name);
      }
      await expect(page.locator("[data-projector-stage] [data-scene='paper']")).toHaveCount(0);

      await expect(startButton(host)).toBeEnabled({ timeout: scaled(20_000) });
      await warmRace(host, lobbyId);
      await startButton(host).click();
      await expect(page.locator("[data-projector-state]")).toHaveAttribute(
        "data-projector-state",
        "racing",
        {
          timeout: scaled(30_000),
        },
      );

      // A leads, B second: the lamp on A
      await a!.type(20);
      await b!.type(10);
      await expect(chip(page, a!.desk)).toHaveAttribute("data-rank", "1", {
        timeout: scaled(10_000),
      });
      await expect(chip(page, b!.desk)).toHaveAttribute("data-rank", "2", {
        timeout: scaled(10_000),
      });
      await expect(embed(page)).toHaveAttribute("data-lamp", String(a!.desk), {
        timeout: scaled(10_000),
      });

      // C66: the bot is dealt a card by its rank (a Smoke Break once last) and plays it after BOT_HOLD_MS; the
      // projector's scene acks the play, mapped from `bonus-sent` as a seat's is
      const bot = [1, 2, 3].find((d) => d !== a!.desk && d !== b!.desk)!;
      await expect(stage(page)).toHaveAttribute(
        "data-scene-sabotage",
        new RegExp(`^[a-z-]+:${bot}:[\\d,]+:throw$`),
        {
          timeout: scaled(20_000),
        },
      );

      // C5: B overtakes A: B's chip flips once, the lamp swings to B
      const before = await flipsOf(page, b!.desk);
      await b!.type(25);
      await expect(chip(page, b!.desk)).toHaveAttribute("data-rank", "1", {
        timeout: scaled(10_000),
      });
      await expect.poll(() => flipsOf(page, b!.desk), { timeout: scaled(5_000) }).toBe(before + 1);
      await expect(chip(page, b!.desk)).toHaveAttribute("data-flip", "");
      await expect(embed(page)).toHaveAttribute("data-lamp", String(b!.desk), {
        timeout: scaled(10_000),
      });
      await expect(embed(page)).toHaveAttribute("data-lamp-mode", "swing");

      // under reduced motion: A retakes the lead with no flip, the lamp is set at once
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(stage(page)).toHaveAttribute("data-scene-motion", "reduce");
      const quiet = await flipsOf(page, a!.desk);
      await a!.type(30);
      await expect(chip(page, a!.desk)).toHaveAttribute("data-rank", "1", {
        timeout: scaled(10_000),
      });
      await expect(embed(page)).toHaveAttribute("data-lamp", String(a!.desk), {
        timeout: scaled(10_000),
      });
      await expect(embed(page)).toHaveAttribute("data-lamp-mode", "set");
      expect(await flipsOf(page, a!.desk)).toBe(quiet);
    });
  },
);
