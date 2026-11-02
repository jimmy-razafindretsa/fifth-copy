import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import { disjoint, hostRoom, phaseOf, SEAT_HUD, startButton, warmRace } from "./helpers";

// Contract of #251 C2-C4 (bible 14.3 tablets, 7.10, 18; ADR 0013): the seat view of a running race on a
// tablet, landscape 1024x768 and portrait 768x1024. Playwright cannot open a real on-screen keyboard, so
// C3 emulates one the way it looks to the page: the viewport height drops to 45 % right after the race
// input takes focus, and comes back. The page under test takes a desk alone (the host waits in its own
// context). Tablet project only; the tests set their own sizes.

const SIZES = [
  { name: "landscape", width: 1024, height: 768 },
  { name: "portrait", width: 768, height: 1024 },
] as const;

const seat = (page: Page) => page.locator("[data-seat]");
const input = (page: Page) => page.locator("[data-race-input]");
const nextChar = (page: Page) => page.locator('[data-sheet] [data-state="next"]');

async function boxOf(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

/** The box lies fully inside a `width` x `height` viewport. */
async function expectInside(locator: Locator, width: number, height: number, at: string) {
  const b = await boxOf(locator);
  expect(b.x, `${at} left`).toBeGreaterThanOrEqual(0);
  expect(b.y, `${at} top`).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, `${at} right`).toBeLessThanOrEqual(width + 0.5);
  expect(b.y + b.height, `${at} bottom`).toBeLessThanOrEqual(height + 0.5);
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("#251 tablet seat view", () => {
  test.skip(({ viewport }) => viewport?.width !== 768, "tablet project; tests set their sizes");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /** The page takes a desk in a fresh room and the race runs (the input is live, Abandon enabled). */
  async function running(page: Page, browser: Browser) {
    test.slow();
    const room = await hostRoom(browser, opened);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" })).toBeVisible({
      timeout: scaled(20_000),
    });
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(15_000),
    });
    await expect(input(page)).toBeFocused();
    await expect(seat(page)).toHaveAttribute("data-osk", "closed");
    return room;
  }

  /** Focuses the race input again, as a tap on the typing surface does (#559). */
  async function refocus(page: Page) {
    await input(page).evaluate((el: HTMLInputElement) => {
      el.blur();
      el.focus({ preventScroll: true });
    });
  }

  test("C2 landscape and portrait: strip, sheet, nixie, compact race card and Abandon in view, no sideways scroll, the card clear of the typewriter", async ({
    page,
    browser,
  }) => {
    await running(page, browser);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(seat(page)).toHaveAttribute("data-orientation", size.name);
      for (const part of ["telex", "sheet", "nixie", "raceCard", "abandon"] as const) {
        await expect(SEAT_HUD[part](page), `${size.name} ${part}`).toBeVisible();
        await expectInside(SEAT_HUD[part](page), size.width, size.height, `${size.name} ${part}`);
      }
      await expect(SEAT_HUD.raceCard(page)).toHaveAttribute("data-compact", "true");
      const card = await boxOf(SEAT_HUD.raceCard(page));
      const machine = await boxOf(SEAT_HUD.machine(page));
      expect(disjoint(card, machine), `${size.name}: race card vs machine`).toBe(true);
      expect(await horizontalOverflow(page), `${size.name}: horizontal scroll`).toBeLessThanOrEqual(
        0,
      );
    }
  });

  test("C3 an on-screen keyboard (height to 45 % after focus) keeps the strip and the sheet's next line in view and folds the machine away; it returns when the height recovers", async ({
    page,
    browser,
  }) => {
    await running(page, browser);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400); // past the 300 ms window of the GO focus

      // a hardware keyboard: the focus shrinks nothing, the full layout stays
      await refocus(page);
      await page.waitForTimeout(400);
      await expect(seat(page), `${size.name} hardware`).toHaveAttribute("data-osk", "closed");
      await expect(SEAT_HUD.machine(page)).toBeVisible();

      // the on-screen keyboard opens over the bottom of the page
      const short = Math.round(size.height * 0.45);
      await refocus(page);
      await page.setViewportSize({ width: size.width, height: short });
      await expect(seat(page), `${size.name} osk`).toHaveAttribute("data-osk", "open");
      await expect(SEAT_HUD.machine(page), `${size.name} machine folded`).toBeHidden();
      await expectInside(SEAT_HUD.telex(page), size.width, short, `${size.name} osk strip`);
      await expectInside(nextChar(page), size.width, short, `${size.name} osk next char`);
      expect(await horizontalOverflow(page), `${size.name} osk sideways`).toBeLessThanOrEqual(0);
      await expect(input(page)).toBeFocused();

      // it closes: the keyboard returns
      await page.setViewportSize(size);
      await expect(seat(page), `${size.name} recovered`).toHaveAttribute("data-osk", "closed");
      await expect(SEAT_HUD.machine(page)).toBeVisible();
    }
  });

  test("C4 every interactive control of the seat view at 768 px is at least 44x44", async ({
    page,
    browser,
  }) => {
    await running(page, browser);
    await page.setViewportSize({ width: 768, height: 1024 });
    // Abandon stays visible and inert until #233 wires it (bible 7.1): its one button is measured
    await expect(SEAT_HUD.abandon(page).getByRole("button")).toHaveCount(1);

    const small = await seat(page).evaluate((root) => {
      const controls = root.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]',
      );
      const out: string[] = [];
      let measured = 0;
      for (const el of controls) {
        // the race input is a visually hidden capture: its touch target is the whole typing surface (#559)
        if (el.matches("[data-race-input]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // not rendered (phones notice, hidden states)
        measured += 1;
        if (r.width < 44 || r.height < 44) {
          const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30);
          out.push(
            `${el.tagName.toLowerCase()} "${name}" ${r.width.toFixed(1)}x${r.height.toFixed(1)}`,
          );
        }
      }
      return { out, measured };
    });
    expect(small.measured, "controls measured").toBeGreaterThan(0);
    expect(small.out).toEqual([]);

    // the typing surface the hidden input answers to is far larger than 44x44
    const surface = await boxOf(SEAT_HUD.sheet(page));
    expect(surface.width).toBeGreaterThanOrEqual(44);
    expect(surface.height).toBeGreaterThanOrEqual(44);
  });
});
