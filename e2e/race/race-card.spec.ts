import type { Locator, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  createLobby,
  lobbyIdOf,
  phaseOf,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #564 C4, C5, C6: the race card over the live snapshots of the race server started by
// playwright.config.ts. The viewer is the page under test and hosts the room; the other typists are
// simulated players (Node sockets, `simulatedPlayers`). Their scripted keys set the ranks; the page's
// full-field line and lanes follow the 10 Hz snapshots. A MutationObserver installed before the page
// loads times the lane changes on this machine's clock (the simulated players' emits use the same one).
// Every test drives its own viewports, so only the desktop project runs.

const RED = "rgb(184, 29, 36)";

type LaneLog = { sets: { t: number; desks: string }[] };

/** Runs in the page before its scripts: logs every change of the lane set (desks in rank order). */
function recorder() {
  const log: LaneLog = { sets: [] };
  (window as unknown as { __lanes: LaneLog }).__lanes = log;
  let last = "";
  new MutationObserver(() => {
    const desks = [...document.querySelectorAll("[data-race-card] [data-lane]")]
      .map((li) => li.getAttribute("data-desk"))
      .join(",");
    if (desks !== last) {
      last = desks;
      log.sets.push({ t: Date.now(), desks });
    }
  }).observe(document, { subtree: true, childList: true, attributes: true });
}

const card = (page: Page) => page.locator("[data-race-card]");
const lanes = (page: Page) => card(page).locator("[data-lane]");
const laneDesks = async (page: Page) =>
  await lanes(page).evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-desk"))));
const box = async (locator: Locator) => (await locator.boundingBox())!;
const disjoint = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

test.describe("#564 race card wiring", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  let sims: SimulatedPlayer[] = [];
  test.afterEach(() => {
    for (const sim of sims.splice(0)) sim.close();
  });

  /**
   * The viewer creates a room, `n - 1` simulated players join it, the viewer starts and waits for GO.
   * Returns the viewer's desk and the race text as the telex shows it.
   */
  async function race(page: Page, n: number) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(recorder);
    const code = await createLobby(page);
    const lobbyId = await lobbyIdOf(code);
    sims = await simulatedPlayers(n - 1, lobbyId);
    await expect(startButton(page)).toBeEnabled({ timeout: scaled(10_000) });
    await warmRace(page, lobbyId);
    await startButton(page).click();
    await expect(page).toHaveURL(/\/race\/[0-9a-f-]{36}$/, { timeout: scaled(20_000) });
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(15_000),
    });
    await expect(page.getByRole("textbox", { name: "Text to type" })).toBeFocused();
    const heading = (await page.getByRole("heading", { level: 1 }).textContent())!;
    const desk = Number(/DESK (\d{2})$/.exec(heading)![1]);
    const text = (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
    return { desk, text };
  }

  test("C4 12 typists: 12 ticks, 7 lanes with you 5th in red; a trailing player passes you and the lanes change within 1 s", async ({
    page,
  }) => {
    const { desk, text } = await race(page, 12);
    // the viewer types 3 keys; four players type more (6..9), seven stay behind at 0 (ties rank by desk)
    await page.keyboard.type(Array.from(text).slice(0, 3).join(""));
    const ahead = sims.slice(0, 4);
    const behind = sims.slice(4);
    for (const [i, sim] of ahead.entries()) await sim.type(6 + i);

    await expect(card(page).locator("[data-tick]")).toHaveCount(12);
    await expect(lanes(page)).toHaveCount(7, { timeout: scaled(5_000) });
    const you = lanes(page).and(page.locator('[data-you="true"]'));
    await expect(you).toHaveAttribute("data-desk", String(desk));
    await expect(you).toHaveAttribute("data-desk-progress", "3", { timeout: scaled(5_000) });
    await expect(you).toHaveAttribute("aria-label", /^Place 5, /);
    // top 3, the two ahead of you (4th, and the 3rd counted once), you, the two behind
    const before = await laneDesks(page);
    expect(before.slice(0, 4).sort((a, b) => a - b)).toEqual(ahead.map((s) => s.desk));
    expect(before[4]).toBe(desk);
    expect(before.slice(5)).toEqual(behind.slice(0, 2).map((s) => s.desk));
    // your lane is red: the marker in the `you` role, the tick too
    const fill = await you.locator("svg").evaluate((el) => getComputedStyle(el).fill);
    expect(fill).toBe(RED);
    const tick = card(page).locator(`[data-tick][data-you="true"]`);
    expect(await tick.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(RED);
    await expect(card(page).locator("[data-lane]:not([data-you]) svg").first()).not.toHaveCSS(
      "fill",
      RED,
    );

    // the last trailing player (not in the lanes) passes you: you drop to 6th, the window takes 8 lanes
    const passer = behind.at(-1)!;
    expect(before).not.toContain(passer.desk);
    const sentAt = await passer.type(4);
    await expect(lanes(page)).toHaveCount(8, { timeout: scaled(5_000) });
    const after = await laneDesks(page);
    expect(after[4]).toBe(passer.desk);
    expect(after[5]).toBe(desk);
    await expect(you).toHaveAttribute("aria-label", /^Place 6, /);
    const log = await page.evaluate(() => (window as unknown as { __lanes: LaneLog }).__lanes);
    const changed = log.sets.find(
      (s) => s.t >= sentAt && s.desks.split(",").includes(String(passer.desk)),
    );
    expect(changed, "the lane set with the passer").toBeDefined();
    test.info().annotations.push({
      type: "timing",
      description: `lanes changed ${changed!.t - sentAt} ms after the pass was sent`,
    });
    expect(changed!.t - sentAt, "lane set change after the pass (ms)").toBeLessThanOrEqual(1_000);
    await expectNoA11yViolations(page);
  });

  test("C5 6 typists: all 6 lanes show", async ({ page }) => {
    const { desk } = await race(page, 6);
    await expect(card(page).locator("[data-tick]")).toHaveCount(6);
    await expect(lanes(page)).toHaveCount(6, { timeout: scaled(5_000) });
    expect((await laneDesks(page)).sort((a, b) => a - b)).toEqual(
      [desk, ...sims.map((s) => s.desk)].sort((a, b) => a - b),
    );
  });

  test("C6 compact at 768 and 1024, full at 1280; the card never meets the typewriter", async ({
    page,
  }) => {
    await race(page, 8);
    await expect(lanes(page)).toHaveCount(8, { timeout: scaled(5_000) });
    for (const [width, height, compact] of [
      [768, 1024, true],
      [1024, 768, true],
      [1280, 800, false],
    ] as const) {
      await page.setViewportSize({ width, height });
      if (compact) {
        await expect(card(page)).toHaveAttribute("data-compact", "true");
        await expect(card(page).locator("[data-name]")).toHaveCount(0);
      } else {
        await expect(card(page)).not.toHaveAttribute("data-compact");
        await expect(card(page).locator("[data-name]")).toHaveCount(8);
      }
      const a = await box(card(page));
      const b = await box(page.locator("[data-machine]"));
      expect(disjoint(a, b), `${width}: race card vs typewriter`).toBe(true);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${width}: horizontal scroll`).toBeLessThanOrEqual(0);
    }
  });
});
