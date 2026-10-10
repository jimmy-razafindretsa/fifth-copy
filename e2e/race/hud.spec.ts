import type { Locator, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";

/**
 * #560 seat view HUD dockets on /design#race-hud: nixie counters, race card, Sabotage tray, Abandon
 * control, notices and race stamps (C1-C7), computed in the browser. Runs in every viewport project.
 */
const RED = "rgb(184, 29, 36)";
const NIXIE = "rgb(255, 154, 60)";
const VIOLET = "rgb(62, 58, 120)";

const state = (page: Page, id: string) => page.locator(`[data-hud-state="${id}"]`);

async function styleOf(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      family: s.fontFamily,
      color: s.color,
      bg: s.backgroundColor,
      bgImage: s.backgroundImage,
      fill: s.fill,
      textShadow: s.textShadow,
      boxShadow: s.boxShadow,
      border: `${s.borderTopWidth} ${s.borderTopStyle}`,
      animation: s.animationName,
      duration: s.animationDuration,
    };
  });
}

async function open(page: Page) {
  await page.goto("/design#race-hud");
  await expect(page.getByRole("heading", { level: 2, name: "Race HUD" })).toBeVisible();
}

test.describe("#560 race HUD on /design", () => {
  test("C1 nixie counters: VT323 numerals, glow only on the tubes, words for assistive tech", async ({
    page,
  }) => {
    await open(page);
    const racing = state(page, "nixie-racing");
    await expect(
      racing.getByRole("group", { name: "Words per minute 42, place 4 of 30" }),
    ).toBeVisible();
    await expect(racing.locator("[data-tube]")).toHaveText(["42", "04 / 30"]);
    await expect(state(page, "nixie-before-start").locator("[data-tube]")).toHaveText([
      "00",
      "00 / 30",
    ]);
    for (const tube of await racing.locator("[data-tube]").all()) {
      const s = await styleOf(tube);
      expect(s.family).toMatch(/VT323/i);
      expect(s.color).toBe(NIXIE);
      expect(s.textShadow).not.toBe("none");
      expect(s.boxShadow).toContain("inset");
    }
    const bezel = await styleOf(racing.locator("[data-device]"));
    expect(bezel.textShadow).toBe("none");
    expect(bezel.boxShadow).toBe("none");
    for (const tag of await racing.locator("[data-device] > span > span:not([data-tube])").all()) {
      const s = await styleOf(tag);
      expect(s.textShadow).toBe("none");
      expect(s.boxShadow).toBe("none");
    }
  });

  test("C2 race card: one tick per player, your tick and lane red, rivals violet, checkered finish", async ({
    page,
  }) => {
    await open(page);
    const thirty = state(page, "card-thirty-mid-field");
    await expect(thirty.locator("[data-tick]")).toHaveCount(30);
    await expect(thirty.locator("[data-lane]")).toHaveCount(8);
    const you = thirty.locator('[data-tick][data-you="true"]');
    await expect(you).toHaveCount(1);
    expect((await styleOf(you)).bg).toBe(RED);
    expect((await styleOf(thirty.locator("[data-tick]:not([data-you])").first())).bg).toBe(VIOLET);
    const finish = await styleOf(thirty.locator("[data-finish]"));
    expect(finish.bgImage).toContain("repeating-conic-gradient");
    expect((await styleOf(thirty.locator('[data-lane][data-you="true"] svg'))).fill).toBe(RED);
    expect((await styleOf(thirty.locator("[data-lane]:not([data-you]) svg").first())).fill).toBe(
      VIOLET,
    );
    // ticks sit along the line by progress: the finished desk at the end, yours mid-field
    const line = await thirty
      .locator("[data-tick]")
      .first()
      .evaluate((el) => {
        const track = el.parentElement!.getBoundingClientRect();
        return [...el.parentElement!.children].map((t) => {
          const b = t.getBoundingClientRect();
          return {
            desk: Number((t as HTMLElement).dataset.desk),
            x: (b.left + b.width / 2 - track.left) / track.width,
          };
        });
      });
    expect(line.find((t) => t.desk === 9)!.x).toBeCloseTo(1, 1);
    expect(line.find((t) => t.desk === 17)!.x).toBeCloseTo(0.61, 1);
    const statuses = state(page, "card-six-statuses");
    for (const label of ["FILED", "LINE CUT", "ASLEEP AT DESK", "REASSIGNED"]) {
      await expect(statuses.getByText(label, { exact: true })).toBeVisible();
    }
    for (const shape of ["circle", "square", "triangle", "diamond"]) {
      await expect(statuses.locator(`svg[data-marker="${shape}"]`).first()).toBeVisible();
    }
  });

  test("C3 compact race card: names hidden, markers, desks and the field line kept", async ({
    page,
  }) => {
    await open(page);
    const compact = state(page, "card-thirty-compact").locator("[data-race-card]");
    await expect(compact).toHaveAttribute("data-compact", "true");
    await expect(compact.locator("[data-name]")).toHaveCount(0);
    await expect(compact.locator("[data-tick]")).toHaveCount(30);
    await expect(compact.locator("svg[data-marker]")).toHaveCount(8);
    await expect(compact.getByText("DESK 17", { exact: true })).toBeVisible();
    const box = await compact.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(208);
    // the lanes still read in words, names included
    await expect(compact.locator('[data-lane][data-you="true"]')).toHaveAttribute(
      "aria-label",
      /Sparrow-629, desk 17/,
    );
  });

  test("C4 Sabotage tray: a 7.4 docket in every state", async ({ page }) => {
    await open(page);
    for (const id of [
      "tray-empty",
      "tray-extra-paperwork",
      "tray-exemption",
      "tray-smoke-break",
      "tray-cooling",
      "tray-held-cooling",
    ]) {
      const tray = state(page, id).getByRole("region", { name: "SABOTAGE TRAY" });
      await expect(tray, id).toBeVisible();
      expect((await styleOf(tray)).border, id).toBe("2px solid");
    }
    await expect(state(page, "tray-empty").getByText("NO CARD", { exact: true })).toBeVisible();
    await expect(state(page, "tray-smoke-break").locator("[data-row=play]")).toContainText(
      "ENTER TO PLAY",
    );
    const cooling = state(page, "tray-cooling");
    await expect(cooling.locator("[data-row]")).toHaveCount(1);
    await expect(cooling.locator("[data-row=cooldown]")).toContainText("12 S");
  });

  test("C5 Abandon: confirm opens beside it, Escape and 5 s cancel, disabled is inert, 44 px targets", async ({
    page,
  }) => {
    await page.clock.install();
    await open(page);
    const demo = page.locator('[data-abandon-demo="ready"]');
    await expect(demo).toBeVisible();
    const abandon = demo.getByRole("button", { name: "ABANDON", exact: true });
    const confirm = demo.getByRole("button", { name: "CONFIRM · REASSIGN ME" });

    await abandon.click();
    await expect(confirm).toBeVisible();
    await expect(abandon).toHaveAttribute("aria-expanded", "true");
    for (const b of [abandon, confirm])
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);

    await abandon.click();
    await expect(confirm).toBeVisible();
    await page.clock.runFor(4_800);
    await expect(confirm).toBeVisible();
    await page.clock.runFor(400);
    await expect(confirm).toHaveCount(0);

    await abandon.click();
    await confirm.click();
    await expect(abandon).toBeDisabled();
    await expect(
      state(page, "abandon-disabled").getByRole("button", { name: "ABANDON" }),
    ).toBeDisabled();
    await expect(state(page, "abandon-confirm").getByRole("button")).toHaveCount(2);
  });

  test("C6 notices: status rows pulsing with lkPulse, still under reduced motion", async ({
    page,
  }) => {
    await open(page);
    for (const [kind, text] of [
      ["waiting-for-host", "WAITING FOR THE HOST"],
      ["reconnecting", "LINE CUT · RECONNECTING"],
      ["idle-warning", "THE MAJOR IS LOOKING AT YOU. TYPE."],
      ["no-scene", "NO PICTURE FROM THE ROOM · KEEP TYPING"],
    ] as const) {
      const row = state(page, `notice-${kind}`).getByRole("status");
      await expect(row).toHaveText(text);
      const s = await styleOf(row);
      expect(s.animation, kind).toContain("lkPulse");
      expect(s.duration, kind).toBe("1.3s");
    }
    const still = await styleOf(state(page, "notice-reduced-motion").getByRole("status"));
    expect(still.animation).toBe("none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await styleOf(state(page, "notice-waiting-for-host").getByRole("status"));
    expect(reduced.animation).toBe("none");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C7 every state and the race stamps, axe clean, no sideways scroll (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      const stamps = state(page, "stamps");
      for (const text of ["GO", "OVERTAKE +1", "PASSED −1", "ACCEPTED · 48 WPM"]) {
        await expect(stamps.getByText(text)).toBeVisible();
      }
      await expect(stamps.locator('[data-stamp-tone="ink"]')).toContainText("PASSED −1");
      await expect(page.locator("#race-hud [data-hud-state]")).toHaveCount(26);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
      await expectNoA11yViolations(page);
    });
  }
});
