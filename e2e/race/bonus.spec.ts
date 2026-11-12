import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  simulatedPlayers,
  startButton,
  warmRace,
  type SimulatedPlayer,
} from "./helpers";

// Contract of #236 C4: the Sabotage tray and the bonus effects over #190's race server (started by
// playwright.config.ts; the paper fallback, no `@scene`). Cards need three typing desks
// (`MIN_BONUS_DESKS`), dealt by live rank (ties rank by desk): the host leads at desk 1, the guest (the
// page under test) takes its desk from the seat view, and simulated players (`simulatedPlayers`, Node
// sockets that never type) fill the other desks before or after it, so the guest's rank picks its card:
// 2nd of 3 -> Extra Paperwork on the leader, 3rd of 3 -> Smoke Break on everyone ahead, 6th of 8 ->
// Exemption on itself (`rankPct` 5/7 = 0.71: the smallest field inside Exemption's [0.67, 0.75) band;
// 3rd of 4 is 0.667, Extra Paperwork). The guest plays with a bare Enter (or the tray's button); the server answers
// with `bonus-sent` and `bonus-hit`, a refusal with `rejected { no-bonus }`. The cooldown is the engine's
// 15 s (not scaled by the fast clock), so each test budgets for it. Every test drives its own
// viewport, so only the desktop project runs.

/** `bonus:play` frames the page sent, with their time. */
type Sent = { t: number }[];

const tray = (page: Page) => page.locator("[data-sabotage-tray]");
const chars = (page: Page) => page.locator("[data-telex] [data-state]");
const input = (page: Page) => page.getByRole("textbox", { name: /^(Text to type|Texte à taper)$/ });

test.describe("#236 Sabotage tray and bonus effects", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  const opened: BrowserContext[] = [];
  const sims: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const sim of sims.splice(0)) sim.close();
    for (const context of opened.splice(0)) await context.close();
  });

  /**
   * Host (desk 1) and guest, with `before` simulated players seated ahead of the guest and `after`
   * behind it; the race runs and both pages are typing. The host types a few characters to lead.
   */
  async function race(
    page: Page,
    browser: Parameters<typeof hostRoom>[0],
    { before, after }: { before: number; after: number },
  ) {
    const room = await hostRoom(browser, opened, {
      before: (host) => host.setViewportSize({ width: 1280, height: 800 }),
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    const sent: Sent = [];
    page.on("websocket", (ws) =>
      ws.on("framesent", ({ payload }) => {
        if (String(payload).startsWith('42["bonus:play"')) sent.push({ t: Date.now() });
      }),
    );
    if (before) sims.push(...(await simulatedPlayers(before, room.lobbyId)));
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/\d{2}$/);
    if (after) {
      sims.push(
        ...(await simulatedPlayers(after, room.lobbyId, {
          names: Array.from({ length: after }, (_, i) => `Sim-B${i + 1}`),
        })),
      );
    }
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
      await expect(p.locator("[data-countdown]")).toHaveCount(0, { timeout: scaled(5_000) });
    }
    await expect(input(room.host)).toBeFocused();
    const text = (await chars(room.host).allTextContents()).join("");
    await room.host.keyboard.type(Array.from(text).slice(0, 4).join(""));
    await expect(input(page)).toBeFocused();
    return { room, sent };
  }

  test("C4 Extra Paperwork: the guest plays it with Enter, the leader's strip gains words; the same card on the same target reads IMMUNE", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const { room, sent } = await race(page, browser, { before: 0, after: 1 });

    // 2nd of 3: the guest is dealt Extra Paperwork, ready, with its hint and button
    await expect(tray(page)).toHaveAttribute("data-card", "extra-paperwork", {
      timeout: scaled(5_000),
    });
    await expect(tray(page).locator("[data-row=play] dd")).toHaveText("ENTER TO PLAY");
    await expect(tray(page).getByRole("button", { name: "PLAY CARD" })).toBeVisible();
    await expectNoA11yViolations(page);

    const before = await chars(room.host).count();
    const guestBefore = await chars(page).count();
    await page.keyboard.press("Enter");
    // Enter types nothing on the guest's own strip
    await expect(tray(page)).toHaveAttribute("data-cooling", "true", { timeout: scaled(5_000) });
    expect(await chars(page).count()).toBe(guestBefore);
    await expect(page.locator("[data-telex] [data-state=done]")).toHaveCount(0);
    // the leader's strip gains the extra words, as text still to type
    await expect
      .poll(() => chars(room.host).count(), { timeout: scaled(5_000) })
      .toBeGreaterThan(before);
    const added = (await chars(room.host).allTextContents()).slice(before);
    expect(added.join("").trim().split(/\s+/).length).toBeGreaterThanOrEqual(1);
    await expect(room.host.locator("[data-telex] [data-state]").nth(before)).toHaveAttribute(
      "data-state",
      "remaining",
    );

    // the cooldown counts down once a second; Enter while cooling sends nothing
    const cooldown = tray(page).locator("[data-row=cooldown] dd");
    await expect(cooldown).toHaveText(/^1[0-5] S$/);
    const first = Number(/\d+/.exec((await cooldown.textContent())!)![0]);
    await expect(cooldown).toHaveText(`${first - 1} S`, { timeout: scaled(2_500) });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect(sent).toHaveLength(1);

    // still 2nd of 3, the guest is dealt the same card again; once ready, the leader is immune
    await expect(tray(page).locator("[data-row=play]")).toBeVisible({ timeout: scaled(20_000) });
    await expect(tray(page)).toHaveAttribute("data-card", "extra-paperwork");
    const hostNow = await chars(room.host).count();
    await page.keyboard.press("Enter");
    const refused = tray(page).locator("[data-row=refused]");
    await expect(refused).toHaveText("IMMUNE", { timeout: scaled(5_000) });
    await expect(tray(page).locator("[role=status][data-refusal]")).toContainText("IMMUNE");
    expect(await refused.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/lkShake/);
    expect(sent).toHaveLength(2);
    // the card is kept, nothing reached the leader, and the row leaves after 1.2 s
    await expect(tray(page)).toHaveAttribute("data-card", "extra-paperwork");
    await expect(refused).toHaveCount(0, { timeout: scaled(3_000) });
    expect(await chars(room.host).count()).toBe(hostNow);
  });

  test("C4 Smoke Break: the last desk plays it, the leader's strip and sheet blur for a few seconds, also under reduced motion", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { room } = await race(page, browser, { before: 1, after: 0 });

    // 3rd of 3: Smoke Break
    await expect(tray(page)).toHaveAttribute("data-card", "smoke-break", {
      timeout: scaled(5_000),
    });
    await page.keyboard.press("Enter");
    const strip = room.host.locator("[data-telex]");
    await expect(strip).toHaveAttribute("data-blur", "true", { timeout: scaled(5_000) });
    await expect(room.host.locator("[data-sheet]")).toHaveAttribute("data-blur", "true");
    const blurAt = Date.now();
    expect(
      await strip
        .locator("div")
        .first()
        .evaluate((el) => getComputedStyle(el).filter),
    ).toBe("blur(3px)");
    // the host keeps typing while blurred
    await expect(input(room.host)).toBeFocused();
    // the blur lifts at its end (the engine's 5 s), on its own
    await expect(strip).not.toHaveAttribute("data-blur", { timeout: scaled(8_000) });
    expect(Date.now() - blurAt).toBeGreaterThan(2_500);
    // the sender's own strip never blurs
    await expect(page.locator("[data-telex]")).not.toHaveAttribute("data-blur");
  });

  test("C4 Exemption: 6th of 8 plays it with the tray's button, the guest's own remaining text shrinks and the input keeps the focus", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(90_000));
    await page.emulateMedia({ colorScheme: "dark" });
    const { sent } = await race(page, browser, { before: 4, after: 2 });

    await expect(tray(page)).toHaveAttribute("data-card", "exemption", {
      timeout: scaled(5_000),
    });
    const before = await chars(page).count();
    await tray(page).getByRole("button", { name: "PLAY CARD" }).click();
    await expect.poll(() => chars(page).count(), { timeout: scaled(5_000) }).toBeLessThan(before);
    expect(sent).toHaveLength(1);
    await expect(input(page)).toBeFocused();
    // the next key still types: the first char turns done
    const first = (await chars(page).first().textContent())!;
    await page.keyboard.type(first);
    await expect(page.locator("[data-telex] [data-state]").first()).toHaveAttribute(
      "data-state",
      "done",
    );
    await expectNoA11yViolations(page);
  });

  // Contract of #768 C3: the welcome of a reload carries the desk's bonus (the server deals no second
  // card while one is held, so only the welcome can bring it back), then its cooldown.
  test("#768 C3 a guest holding a card reloads mid-race: the tray shows the card, and after a play the cooldown", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const { room, sent } = await race(page, browser, { before: 0, after: 1 });
    await expect(tray(page)).toHaveAttribute("data-card", "extra-paperwork", {
      timeout: scaled(5_000),
    });

    await page.reload();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(15_000),
    });
    await expect(tray(page)).toHaveAttribute("data-card", "extra-paperwork", {
      timeout: scaled(5_000),
    });
    await expect(tray(page).locator("[data-row=play] dd")).toHaveText("ENTER TO PLAY");

    // the held card still plays after the reload
    const before = await chars(room.host).count();
    await expect(input(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tray(page)).toHaveAttribute("data-cooling", "true", { timeout: scaled(5_000) });
    await expect
      .poll(() => chars(room.host).count(), { timeout: scaled(5_000) })
      .toBeGreaterThan(before);
    expect(sent).toHaveLength(1);

    // a reload while cooling: the tray counts the cooldown down, it does not read ready
    await page.reload();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(15_000),
    });
    await expect(tray(page)).toHaveAttribute("data-cooling", "true", { timeout: scaled(5_000) });
    await expect(tray(page).locator("[data-row=cooldown] dd")).toHaveText(/^\d{1,2} S$/);
    await expect(tray(page).locator("[data-row=play]")).toHaveCount(0);
  });
});
