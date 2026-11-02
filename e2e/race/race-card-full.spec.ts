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

// Contract of #226 C1: the race card in a crowded race. The viewer hosts the room and 29 simulated players
// (`simulatedPlayers`, #564) fill it to 30 desks; desks follow the order the sockets seat, so the viewer
// can sit at any desk and the leaders are chosen once the viewer's desk is known. Four players type ahead
// of the viewer, so the viewer is 5th of 30 and the lanes are ranks 1..7 (top 3, the two ahead of you
// counted once, you, the two behind). Three of the four share one ink (desks k+1, k+13, k+25: rival-k on
// circle, square, triangle; the allocator's `deskIdentity`, #565), so "distinct (colour, shape)" is
// checked where it can fail. The test drives its own viewports, so only the desktop project runs.

const RED = "rgb(184, 29, 36)";

/**
 * The four leaders for a viewer at `you`: the three desks of the first ink k whose band desks
 * (k+1, k+13, k+25) are all rivals, plus the next rival desk. Returns the shared ink too.
 */
function leadersFor(you: number) {
  for (let k = 0; k < 6; k++) {
    const trio = [k + 1, k + 13, k + 25];
    if (trio.includes(you)) continue;
    const fourth = Array.from({ length: 30 }, (_, i) => i + 1).find(
      (d) => d !== you && !trio.includes(d),
    )!;
    return { desks: [...trio, fourth], ink: `rival-${k}` };
  }
  throw new Error(`no ink band free of desk ${you}`);
}

const card = (page: Page) => page.locator("[data-race-card]");
const lanes = (page: Page) => card(page).locator("[data-lane]");
const box = async (locator: Locator) => (await locator.boundingBox())!;
const disjoint = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

test.describe("#226 race card, 30 typists", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; the test sets its viewports",
  );

  let sims: SimulatedPlayer[] = [];
  test.afterEach(() => {
    for (const sim of sims.splice(0)) sim.close();
  });

  test("C1 30 ticks, 7 lanes, distinct rival markers with desk numbers, you in red; compact at 768 and clear of the typewriter", async ({
    page,
  }) => {
    test.setTimeout(scaled(120_000));
    await page.setViewportSize({ width: 1280, height: 800 });
    const code = await createLobby(page);
    const lobbyId = await lobbyIdOf(code);
    sims = await simulatedPlayers(29, lobbyId);
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

    // the viewer types 3 keys, four players type more (6..9), the other 25 stay at 0 (ties rank by desk)
    await page.keyboard.type(Array.from(text).slice(0, 3).join(""));
    const leaders = leadersFor(desk);
    const ahead = leaders.desks.map((d) => sims.find((s) => s.desk === d)!);
    expect(ahead.every(Boolean), `simulated players at desks ${leaders.desks.join(", ")}`).toBe(
      true,
    );
    for (const [i, sim] of ahead.entries()) await sim.type(6 + i);

    await expect(card(page).locator("[data-tick]")).toHaveCount(30);
    await expect(card(page).locator("[data-tick][data-you]")).toHaveCount(1);
    const you = lanes(page).and(page.locator('[data-you="true"]'));
    await expect(you).toHaveAttribute("aria-label", /^Place 5, /, { timeout: scaled(5_000) });
    await expect(lanes(page)).toHaveCount(7, { timeout: scaled(5_000) });
    await expect(you).toHaveAttribute("data-desk", String(desk));

    // every visible rival: its own (ink, shape) pair, the allocator's, and its desk number on the lane
    const rivals = await lanes(page)
      .and(page.locator(":not([data-you])"))
      .evaluateAll((els) =>
        els.map((el) => ({
          desk: Number(el.getAttribute("data-desk")),
          ink: el.getAttribute("data-ink"),
          shape: el.querySelector("svg[data-marker]")?.getAttribute("data-marker"),
          text: (el as HTMLElement).innerText,
          fill: getComputedStyle(el.querySelector("svg")!).fill,
        })),
      );
    expect(rivals).toHaveLength(6);
    const shapes = ["circle", "square", "triangle", "diamond"];
    for (const r of rivals) {
      expect(r.ink, `desk ${r.desk} ink`).toBe(`rival-${(r.desk - 1) % 12}`);
      expect(r.shape, `desk ${r.desk} shape`).toBe(shapes[Math.floor((r.desk - 1) / 12) % 4]);
      expect(r.text, `desk ${r.desk} number`).toContain(`DESK ${String(r.desk).padStart(2, "0")}`);
      expect(r.fill, `desk ${r.desk} is not red`).not.toBe(RED);
    }
    const pairs = new Set(rivals.map((r) => `${r.ink}/${r.shape}`));
    expect(pairs.size, "distinct (colour, shape) pairs").toBe(rivals.length);
    const fills = new Set(rivals.map((r) => `${r.fill}/${r.shape}`));
    expect(fills.size, "distinct rendered (fill, shape) pairs").toBe(rivals.length);
    // three rivals wear the same ink: only the shape tells them apart
    expect(
      rivals
        .filter((r) => r.ink === leaders.ink)
        .map((r) => r.shape)
        .sort(),
    ).toEqual(["circle", "square", "triangle"]);

    // the viewer's lane and tick are red, with the desk number shown
    expect(await you.locator("svg").evaluate((el) => getComputedStyle(el).fill)).toBe(RED);
    const tick = card(page).locator("[data-tick][data-you]");
    expect(await tick.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(RED);
    await expect(you).toContainText(`DESK ${String(desk).padStart(2, "0")}`);
    await expectNoA11yViolations(page);

    // the same race in Night shift: still no serious or critical axe violation
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "light" });

    // 768 px: compact (names gone, markers and desk numbers kept), disjoint from the typewriter
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(card(page)).toHaveAttribute("data-compact", "true");
    await expect(card(page).locator("[data-name]")).toHaveCount(0);
    await expect(lanes(page)).toHaveCount(7);
    await expect(lanes(page).locator("svg[data-marker]")).toHaveCount(7);
    await expect(card(page).locator("[data-tick]")).toHaveCount(30);
    const a = await box(card(page));
    const b = await box(page.locator("[data-machine]"));
    expect(disjoint(a, b), "768: race card vs typewriter").toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "768: horizontal scroll").toBeLessThanOrEqual(0);
    // the running race at 768 in both themes: no serious or critical axe violation
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "light" });
  });
});
