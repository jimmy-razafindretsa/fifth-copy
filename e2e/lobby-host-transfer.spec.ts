import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  hostRoom,
  joinAsGuest,
  lobbyHostOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
} from "./race/helpers";
import { ACTION_WAIT, scaled } from "./timeouts";

// Contract of #137 C4, C5: the host leaves the waiting room for good and the role passes to the
// earliest-joined human. The host plus two guests in fresh contexts (A joins before B); the race server
// started by playwright.config.ts. A private room (no @matchmaking).
// #884: the host's disconnect waits out the leave grace first, so a reload keeps the role (C4).

/** `LAST_LEAVE_GRACE_MS` (services/race-server/src/players/last-leave.ts): a real-time wait, not scaled. */
const LEAVE_GRACE_MS = 5_000;

const list = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const roll = (page: Page) => list(page).locator("li");
const stamp = (page: Page) => page.locator("[data-new-host]");
const settingsDocket = (page: Page) => page.getByRole("region", { name: "RACE SETTINGS" });
const setting = (page: Page, label: string) =>
  settingsDocket(page)
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("+ dd");
const segment = (page: Page, row: string, name: string) =>
  settingsDocket(page)
    .getByRole("group", { name: row, exact: true })
    .getByRole("button", { name, exact: true });
const botRows = (page: Page) => roll(page).filter({ has: page.getByText("BOT", { exact: true }) });
const hostTag = (page: Page, name: string) =>
  roll(page).filter({ hasText: name }).getByText("HOST", { exact: true });

/** The viewer's own name: the roll row that carries the YOU tag. */
async function ownName(page: Page): Promise<string> {
  const row = roll(page).filter({ has: page.getByText("YOU", { exact: true }) });
  return ((await row.locator("[data-name]").textContent()) ?? "").trim();
}

test.describe("host transfer (#137)", () => {
  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C5 the host closes its page: A and B see NEW HOST: <A> within 3 s of the leave grace (#884), A hosts without a reload, B keeps the guest view, the lobby row follows", async ({
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const { host, code, context } = await hostRoom(browser, opened);
    const a = await joinAsGuest(browser, code, { before: recordRaceTokens });
    opened.push(a.context);
    await expect(roll(host)).toHaveCount(2, { timeout: ACTION_WAIT });
    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    for (const page of [host, a.page, b.page]) {
      await expect(roll(page)).toHaveCount(3, { timeout: ACTION_WAIT });
    }
    const nameA = await ownName(a.page);
    const nameB = await ownName(b.page);
    const before = await lobbyHostOf(code);
    await expect(startButton(a.page)).toHaveCount(0);

    // the host closes its page: a leave in waiting once the grace is out (#884), the role passes to
    // A (joined before B)
    await host.close();
    await context.close();
    for (const page of [a.page, b.page]) {
      await expect(stamp(page)).toHaveText(`NEW HOST: ${nameA.toUpperCase()}`, {
        timeout: LEAVE_GRACE_MS + scaled(3_000),
      });
      await expect(hostTag(page, nameA)).toBeVisible();
      await expect(roll(page)).toHaveCount(2);
    }
    await expectNoA11yViolations(a.page);

    // A hosts without a reload: START (enabled with a bot), the settings form; B has no control
    await expect(startButton(a.page)).toBeVisible();
    await expect(startButton(b.page)).toHaveCount(0);
    await expect(b.page.getByText("WAITING FOR THE HOST", { exact: true })).toBeVisible();
    const phone = (a.page.viewportSize()?.width ?? 0) <= 480;
    if (phone) {
      // phones hide the settings docket (#498): A's own player token sends host:settings
      await setHostSettings(a.page, { bots: [{ level: "clerk" }], errorMode: "block" });
    } else {
      await settingsDocket(a.page).getByRole("button", { name: "ADD A BOT", exact: true }).click();
      await segment(a.page, "ERROR MODE", "BLOCK").click();
      await expect(segment(a.page, "ERROR MODE", "BLOCK")).toHaveAttribute("aria-pressed", "true", {
        timeout: scaled(2_000),
      });
      await expect(settingsDocket(b.page).getByRole("button")).toHaveCount(0);
      await expect(setting(b.page, "ERROR MODE")).toHaveText("BLOCK", { timeout: scaled(2_000) });
    }
    await expect(botRows(b.page)).toHaveCount(1, { timeout: scaled(2_000) });
    await expect(startButton(a.page)).toBeEnabled();
    await expect(list(b.page).getByRole("button")).toHaveCount(0);

    // the durable copy: the lobby row's host is A within 10 s
    await expect
      .poll(async () => (await lobbyHostOf(code))?.name, { timeout: scaled(10_000) })
      .toBe(nameA);
    expect((await lobbyHostOf(code))?.id).not.toBe(before?.id);
    expect(nameB).not.toBe(nameA);

    // the stamp goes after its hold (slow x 5 = 3 s)
    await expect(stamp(b.page)).toHaveCount(0, { timeout: scaled(6_000) });
  });

  test("#884 C4 the host reloads the waiting room with a guest present: still START, the guest never sees NEW HOST", async ({
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    const { host, code } = await hostRoom(browser, opened);
    const guest = await joinAsGuest(browser, code);
    opened.push(guest.context);
    for (const page of [host, guest.page]) {
      await expect(roll(page)).toHaveCount(2, { timeout: ACTION_WAIT });
    }
    const hostName = await ownName(host);
    await expect(startButton(host)).toBeVisible();
    // the guest page records any NEW HOST stamp, however briefly it shows
    await guest.page.evaluate(() => {
      const w = window as unknown as { newHostSeen: boolean };
      w.newHostSeen = false;
      new MutationObserver(() => {
        if (document.querySelector("[data-new-host]")) w.newHostSeen = true;
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });

    await host.reload();
    await expect(roll(host)).toHaveCount(2, { timeout: ACTION_WAIT });
    await expect(startButton(host)).toBeVisible();
    await expect(hostTag(host, hostName)).toBeVisible();

    // past the grace (and the stamp's 3 s): the role never moved
    await guest.page.waitForTimeout(LEAVE_GRACE_MS + scaled(3_000));
    expect(
      await guest.page.evaluate(() => (window as unknown as { newHostSeen: boolean }).newHostSeen),
    ).toBe(false);
    await expect(stamp(guest.page)).toHaveCount(0);
    await expect(hostTag(guest.page, hostName)).toBeVisible();
    await expect(startButton(guest.page)).toHaveCount(0);
    await expect(startButton(host)).toBeVisible();
  });
});
