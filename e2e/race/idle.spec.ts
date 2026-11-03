import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import { hostRoom, phaseOf, SEAT_HUD, startButton, warmRace } from "./helpers";

// Contract of #233 C4 and C5 over the race server playwright.config.ts starts. The server warns a
// connected desk silent for 45 s and puts it to sleep at 60 s (spec 4.5, #183); `RACE_FAST_CLOCK=1` in
// the shell that starts the race server divides both by 10. CI starts it without the flag, so the waits
// are sized from the same variable here: 4.5 s / 6 s with it, 45 s / 60 s without (`test.slow()`, the
// real clock runs about two minutes). The guest page runs under reduced motion (C5). It stays silent:
// the idle notice row comes at the warning; one key clears it; silent again, the warning comes back and,
// at the kick, the ASLEEP AT DESK docket (KEEP WATCHING, LEAVE) replaces it. The host keeps typing one key
// every 3 s (under either warning time) and its race card shows the guest ASLEEP AT DESK.

const FAST = process.env.RACE_FAST_CLOCK === "1";
const WARN_MS = FAST ? 4_500 : 45_000;
const KICK_MS = FAST ? 6_000 : 60_000;
/** The server's idle step and the 10 Hz snapshots land a little after the instant. */
const SLACK_MS = 5_000;

const notice = (page: Page) => page.locator('[data-seat-status] [data-notice="idle-warning"]');
const asleep = (page: Page) => page.locator('[data-seat-status] [data-exit="asleep"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const deskOf = async (page: Page) =>
  Number(/(\d{2})$/.exec((await SEAT_HUD.kicker(page).textContent()) ?? "")![1]);
const animationOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => getComputedStyle(el).animationName);

test.describe("#233 idle warning and Asleep at desk", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C4 C5: the idle notice at the warning, a key clears it, ASLEEP AT DESK at the kick, the host sees it", async ({
    page,
  }) => {
    test.slow();
    test.setTimeout(scaled(30_000 + 2 * (WARN_MS + KICK_MS + 2 * SLACK_MS)));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const room = await hostRoom(page.context().browser()!, opened);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(SEAT_HUD.kicker(page)).toHaveText(/\d{2}$/);
    const guestDesk = await deskOf(page);

    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
    }

    // the host stays awake: one correct key every 3 s (50 words outlast the test)
    const hostText = Array.from(await stripText(room.host));
    let awake = true;
    const keepAwake = (async () => {
      for (let i = 0; awake && i < hostText.length - 1; i++) {
        await room.host.keyboard.type(hostText[i]!);
        for (let w = 0; awake && w < 30; w++) await room.host.waitForTimeout(100);
      }
    })();

    try {
      // C4: no notice while the silence is short; the notice row at the warning time
      await expect(notice(page)).toHaveCount(0);
      await expect(notice(page)).toBeVisible({ timeout: scaled(WARN_MS + SLACK_MS) });
      await expect(notice(page)).toHaveText("THE MAJOR IS LOOKING AT YOU. TYPE.");
      await expect(notice(page)).toHaveAttribute("role", "status");
      await expect(notice(page)).toHaveAttribute("data-tone", "urgent");
      // C5: the pulse holds still under reduced motion
      expect(await animationOf(page, '[data-seat-status] [data-notice="idle-warning"]')).toBe(
        "none",
      );

      // one correct key clears it (the race input has the focus from GO)
      const text = await stripText(page);
      await page.keyboard.type(text[0]!);
      await expect(notice(page)).toHaveCount(0, { timeout: scaled(2_000) });

      // silent again: the warning comes back, then the kick
      await expect(notice(page)).toBeVisible({ timeout: scaled(WARN_MS + SLACK_MS) });
      const docket = asleep(page);
      await expect(docket).toBeVisible({ timeout: scaled(KICK_MS - WARN_MS + SLACK_MS) });
      await expect(notice(page)).toHaveCount(0);
      await expect(docket.locator("[data-stamp-tone]")).toHaveText("ASLEEP AT DESK");
      await expect(docket.locator("[data-stamp-tone]")).toHaveAttribute("data-stamp-tone", "ink");
      await expect(docket.locator('[data-row="wpm"]')).toHaveText(/^WPM\d+$/);
      await expect(docket.locator('[data-row="accuracy"]')).toHaveText(/^ACCURACY\d{1,3} %$/);
      const leave = docket.getByRole("link", { name: "LEAVE →", exact: true });
      await expect(leave).toHaveAttribute("href", `/lobby/${room.code}`);
      // C5: the stamp appears without the slam
      expect(await animationOf(page, '[data-exit="asleep"] [data-stamp-tone]')).toBe("none");
      await expect(page.getByRole("textbox", { name: "Text to type" })).toBeDisabled();

      // the host's race card shows the guest's status
      await expect(
        SEAT_HUD.raceCard(room.host).locator(
          `[data-lane][data-desk="${guestDesk}"] [data-status-label="asleep"]`,
        ),
      ).toHaveText("ASLEEP AT DESK", { timeout: scaled(5_000) });

      // KEEP WATCHING closes the docket; the HUD stays live without input
      await docket.getByRole("button", { name: "KEEP WATCHING", exact: true }).click();
      await expect(docket).toHaveCount(0);
      await expect(phaseOf(page)).toHaveAttribute("data-phase", "running");
      await expect(SEAT_HUD.abandon(page)).toHaveAttribute("data-abandon", "disabled");
    } finally {
      awake = false;
      await keepAwake;
    }
  });
});
