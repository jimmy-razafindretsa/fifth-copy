import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #215 (the parent of #558 and #559): the whole typing path over the race server
// playwright.config.ts starts. Host and one guest in a 10-word room; after GO both strips hold the same
// text; each types all of it with `keyboard.type` read from the strip's spans. Each sheet then ends with
// every span `done`, the hidden input locks and the strip and the sheet carry `data-phase="finished"`
// (`surfacePhase`). C2 runs the same path with the guest under reduced motion: the next cell is a solid
// red cell (no caret blink) and the newest char does not pop (`animation-name: none` on `[data-last]`).

const strip = (page: Page) => page.locator("[data-telex] [data-state]");
const sheet = (page: Page) => page.locator("[data-sheet] [data-state]");
const surface = (page: Page) => page.locator("[data-telex], [data-sheet]");
const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const stripText = async (page: Page) => (await strip(page).allTextContents()).join("");
const styleOf = (page: Page, selector: string, prop: "animationName" | "backgroundColor") =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el)[p], prop);

/** The `--color-typing-next-bg` token as the page resolves it (the solid red cell, bible 7.7, 8). */
const nextCellColour = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--color-typing-next-bg)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });

/** A host and a guest at their desks of one room, the race started and both pages past GO. */
async function startedRace(
  page: Page,
  browser: Parameters<typeof hostRoom>[0],
  opened: BrowserContext[],
) {
  const room = await hostRoom(browser, opened, { before: recordRaceTokens });
  await setHostSettings(room.host, { wordCount: 10 });
  await page.goto(`/race/${room.lobbyId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
  await expect(startButton(room.host)).toBeEnabled();
  await warmRace(room.host, room.lobbyId);
  await startButton(room.host).click();
  await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
  for (const p of [page, room.host]) {
    await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", { timeout: scaled(10_000) });
    await expect(input(p)).toBeFocused();
  }
  return room.host;
}

/** Types the rest of the page's strip (`from` chars already typed), then checks the finished surface (C1). */
async function typeAll(page: Page, text: string, from = 0) {
  await page.keyboard.type(Array.from(text).slice(from).join(""), { delay: 30 });
  const length = Array.from(text).length;
  await expect(sheet(page)).toHaveCount(length);
  expect(
    new Set(await sheet(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-state")))),
  ).toEqual(new Set(["done"]));
  await expect(strip(page).and(page.locator(':not([data-state="done"])'))).toHaveCount(0);
  await expect(input(page)).toBeDisabled();
  for (const el of await surface(page).all())
    await expect(el).toHaveAttribute("data-phase", "finished");
}

test.describe("#215 typing path: telex strip, typed sheet, local prediction", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C1 host and guest type the same text and both finish", async ({ page, browser }) => {
    test.setTimeout(scaled(90_000));
    const host = await startedRace(page, browser, opened);
    for (const p of [page, host])
      await expect(surface(p).first()).toHaveAttribute("data-phase", "before");

    const text = await stripText(page);
    expect(Array.from(text).length).toBeGreaterThan(20);
    expect(await stripText(host)).toBe(text);

    await Promise.all([typeAll(page, text), typeAll(host, text)]);
  });

  test("C2 under reduced motion the next cell is solid red and the newest char does not pop", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const host = await startedRace(page, browser, opened);
    const text = await stripText(page);
    const chars = Array.from(text);

    await page.keyboard.type(chars.slice(0, 5).join(""), { delay: 30 });
    await expect(surface(page).first()).toHaveAttribute("data-phase", "racing");
    for (const root of ["[data-telex]", "[data-sheet]"]) {
      const next = `${root} [data-state="next"]`;
      await expect(page.locator(next)).toHaveCount(1);
      expect(await styleOf(page, next, "animationName"), `${root} caret`).toBe("none");
      // the solid cell: the next-cell token, not a transparent blink phase
      expect(await styleOf(page, next, "backgroundColor"), `${root} caret cell`).toBe(
        await nextCellColour(page),
      );
      const last = `${root} [data-last]`;
      await expect(page.locator(last)).toHaveCount(1);
      expect(await styleOf(page, last, "animationName"), `${root} pop`).toBe("none");
    }

    // the control: the host's motion is on, so its caret blinks and its newest char pops
    await host.keyboard.type(chars[0]!);
    await expect(host.locator("[data-sheet] [data-last]")).toHaveCount(1);
    expect(await styleOf(host, '[data-sheet] [data-state="next"]', "animationName")).not.toBe(
      "none",
    );
    expect(await styleOf(host, "[data-sheet] [data-last]", "animationName")).not.toBe("none");

    await typeAll(page, text, 5);
  });
});
