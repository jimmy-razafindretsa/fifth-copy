import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { hostRoom, phaseOf, startButton, warmRace } from "./helpers";

// Contract of #559 C6: a key never waits for the server. Host and one guest in a room, the host starts;
// after GO the guest types the first 12 characters of the strip: its sheet shows 12 `done` spans within
// 100 ms of the last key, and within 1 s the host's store holds progress 12 for the guest's desk
// (`data-desk-progress`, the last snapshot's cursor). Times are taken in the pages, where they happen
// (an init script records the guest's last key and the sheet's 12th `done`, the host's 12): both pages
// share this machine's clock.

type Log = { lastKeyAt: number; doneAt: number | null; progressAt: Record<string, number> };

/** Runs in each page before its scripts. */
function recorder() {
  const log: Log = { lastKeyAt: 0, doneAt: null, progressAt: {} };
  (window as unknown as { __typing: Log }).__typing = log;
  // the input's own key events: a keydown, or the beforeinput of a char the layout has no key for
  for (const type of ["keydown", "beforeinput"]) {
    document.addEventListener(
      type,
      (e) => {
        if ((e.target as Element | null)?.matches?.("[data-race-input]"))
          log.lastKeyAt = Date.now();
      },
      true,
    );
  }
  new MutationObserver(() => {
    const done = document.querySelectorAll('[data-sheet] [data-state="done"]').length;
    if (log.doneAt === null && done >= 12) log.doneAt = Date.now();
    for (const li of document.querySelectorAll("[data-desks] [data-desk]")) {
      const desk = li.getAttribute("data-desk")!;
      if (li.getAttribute("data-desk-progress") === "12" && !(desk in log.progressAt)) {
        log.progressAt[desk] = Date.now();
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true });
}

const logOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __typing: Log }).__typing);

test.describe("#559 local prediction", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C6 the guest's 12 keys show on its sheet within 100 ms and in the host's store within 1 s", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser, opened, {
      before: async (host) => {
        await host.setViewportSize({ width: 1280, height: 800 });
        await host.addInitScript(recorder);
      },
    });
    // the guest takes a desk from the seat view itself
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(recorder);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
    const desk = String(
      Number(
        /DESK (\d{2})$/.exec((await page.getByRole("heading", { level: 1 }).textContent())!)![1],
      ),
    );
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);

    // the host's START moves the host to the seat view; the guest's turns running at GO
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    await expect(phaseOf(room.host)).toHaveAttribute("data-phase", /countdown|running/);
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    await expect(page.getByRole("textbox", { name: "Text to type" })).toBeFocused();

    const text = (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
    const twelve = Array.from(text).slice(0, 12).join("");
    expect(Array.from(twelve)).toHaveLength(12);
    await page.keyboard.type(twelve);

    await expect(page.locator('[data-sheet] [data-state="done"]')).toHaveCount(12);
    await expect(page.locator('[data-sheet] [data-state="wrong"]')).toHaveCount(0);
    const guest = await logOf(page);
    expect(guest.doneAt, "the sheet's 12th done").not.toBeNull();
    expect(guest.doneAt! - guest.lastKeyAt, "sheet after the last key (ms)").toBeLessThanOrEqual(
      100,
    );

    const progress = room.host.locator(`[data-desks] [data-desk="${desk}"]`);
    await expect(progress).toHaveAttribute("data-desk-progress", "12", { timeout: 2_000 });
    const host = await logOf(room.host);
    expect(host.progressAt[desk], "the host's store").toBeDefined();
    test.info().annotations.push({
      type: "timing",
      description: `sheet ${guest.doneAt! - guest.lastKeyAt} ms, host ${host.progressAt[desk]! - guest.lastKeyAt} ms after the last key`,
    });
    expect(
      host.progressAt[desk]! - guest.lastKeyAt,
      "host after the last key (ms)",
    ).toBeLessThanOrEqual(1_000);
    // the guest's own store agrees with its prediction once the server's snapshot lands
    await expect(page.locator(`[data-desks] [data-desk="${desk}"]`)).toHaveAttribute(
      "data-desk-progress",
      "12",
    );
  });
});
