import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import type { RaceSettingsPatch } from "@fifth-copy/protocol";
import { expect, test } from "../fixtures";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #224 C2, C4-C7, live over the race server started by playwright.config.ts: the seat view's
// machine draws the viewer's keyboard layout (the UI language's until #66 saves one: fr -> CSA, en -> US
// QWERTY) and its keys follow the race store: a keystroke presses its key for the fast token, a wrong key
// stays red on that one cap and shakes (lkShake) each time it is struck, a finished desk disables every
// key, reduced motion moves nothing and keeps the colour states, and taps on a touch screen type nothing.
// The page under test takes a desk at `/race/<lobbyId>`; the host waits in its own context and STARTs.
// Desktop project only: the tests that need a tablet open their own context.

/** Machine colours: the invariant `machine-*` roles and `typing-error`, the same in both themes. */
const RED = "rgb(184, 29, 36)";
const PAPER = "rgb(241, 232, 214)";
const INK = "rgb(42, 36, 32)";
const METAL = "rgb(111, 115, 108)";
const TABLET = { width: 768, height: 1024 };

const input = (page: Page) => page.locator("[data-race-input]");
const machine = (page: Page) => page.locator("[data-machine]");
const keys = (page: Page) => machine(page).locator("[data-key]");
const keyCap = (page: Page, key: string) => machine(page).locator(`[data-key="${key}"]`);
const sheetChars = (page: Page) => page.locator("[data-sheet] [data-state]");

/** `keyboard.press` names the space bar `Space`; any other char presses as itself. */
const keyName = (ch: string) => (ch === " " ? "Space" : ch);

/** The race text as the strip shows it, one char per span. */
async function textOf(page: Page): Promise<string> {
  return (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
}

/** Every key of the machine in document order (the rows, then the space bar). */
const keyList = (page: Page) =>
  keys(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-key")!));

type KeyLog = {
  /** `data-pressed` / `data-wrong` going on or off, with the key and the time. */
  marks: { t: number; key: string; attr: string; on: boolean }[];
  /** `keydown`s that reached the page. */
  downs: { t: number; key: string }[];
  /** The keys whose lkShake animation started, in order. */
  shakes: string[];
};

/** Starts recording the machine's key attributes, the keydowns and the lkShake starts in the page. */
async function watchKeys(page: Page) {
  await page.evaluate(() => {
    const log: KeyLog = { marks: [], downs: [], shakes: [] };
    (window as unknown as { __keys: KeyLog }).__keys = log;
    const root = document.querySelector("[data-machine]")!;
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        const attr = r.attributeName!;
        log.marks.push({
          t: performance.now(),
          key: el.getAttribute("data-key") ?? "",
          attr,
          on: el.hasAttribute(attr),
        });
      }
    }).observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-pressed", "data-wrong"],
    });
    document.addEventListener(
      "keydown",
      (e) => log.downs.push({ t: performance.now(), key: e.key }),
      true,
    );
    document.addEventListener(
      "animationstart",
      (e) => {
        if (/lkShake/.test(e.animationName))
          log.shakes.push((e.target as Element).getAttribute("data-key") ?? "");
      },
      true,
    );
  });
}

const keyLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __keys: KeyLog }).__keys);

/** The computed look of a machine part. */
async function look(locator: Locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      bg: s.backgroundColor,
      color: s.color,
      border: s.borderTopColor,
      borderStyle: s.borderTopStyle,
    };
  });
}

/** The vertical offset of a box-shadow like `rgb(111, 115, 108) 0px 3px 0px 0px`. */
const stem = (shadow: string) => Number(/\)\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(shadow)?.[2]);

/** The parts a key cue must leave alone (bible 8: one key cell, never the deck or the screen). */
async function frame(page: Page) {
  const parts = ["deck", "slot", "panel"] as const;
  return Object.fromEntries(
    await Promise.all(
      parts.map(async (p) => [p, await look(machine(page).locator(`[data-part="${p}"]`))] as const),
    ),
  );
}

/** Waits until `key`'s press went on and off after the last keydown; returns both times from the keydown. */
async function pressOf(page: Page, key: string) {
  let found: { on: number; off: number } | null = null;
  await expect
    .poll(
      async () => {
        const log = await keyLog(page);
        const down = log.downs.at(-1)!;
        const marks = log.marks.filter(
          (m) => m.attr === "data-pressed" && m.key === key && m.t >= down.t,
        );
        const on = marks.find((m) => m.on);
        const off = on && marks.find((m) => !m.on && m.t >= on.t);
        found = on && off ? { on: on.t - down.t, off: off.t - down.t } : null;
        return found !== null;
      },
      { message: `the press of ${JSON.stringify(key)}` },
    )
    .toBe(true);
  return found!;
}

test.describe("#224 machine keys, live", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; the touch test opens its own tablet context",
  );

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /**
   * A fresh room in `settings`: the host sets them, the page takes a desk at `/race/<lobbyId>` (after
   * `before`, e.g. a reduced-motion emulation), the host starts; resolves at GO with the race text.
   */
  async function race(
    page: Page,
    browser: Browser,
    settings: RaceSettingsPatch,
    { before }: { before?: () => Promise<void> } = {},
  ) {
    const room = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, settings);
    await before?.();
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    await expect(input(page)).toBeFocused();
    const text = await textOf(page);
    expect(text.length, "the race text").toBeGreaterThan(1);
    return { room, text };
  }

  test("C2 the layout follows the UI language: French -> CSA (é, è, ç), English -> US QWERTY", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser, opened);
    // the guest's context carries the French UI cookie (ADR 0010); the host stays in English
    await page
      .context()
      .addCookies([{ name: "locale", value: "fr", url: test.info().project.use.baseURL! }]);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^VUE DE TA PLACE/);
    for (const ch of ["é", "è", "ç"]) await expect(keyCap(page, ch), ch).toHaveCount(1);
    const csa = await keyList(page);
    expect(csa.slice(0, 6).join(" ")).toBe("q w e r t y");
    expect(csa).toEqual([..."qwertyuiop^ç", ..."asdfghjkl;èà", ..."ùzxcvbnm,.é", " "]);

    await room.host.goto(`/race/${room.lobbyId}`);
    await expect(room.host.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW/);
    for (const ch of ["é", "è", "ç"]) await expect(keyCap(room.host, ch), ch).toHaveCount(0);
    const us = await keyList(room.host);
    expect(us.slice(0, 6).join(" ")).toBe("q w e r t y");
    expect(us).toContain("[");
    expect(us.at(-1)).toBe(" ");
  });

  test("C4 C5 a key presses its cap for the fast token, a wrong key reds one cap and shakes on every strike, Shift and Dead do nothing", async ({
    page,
    browser,
  }) => {
    const { text } = await race(page, browser, { errorMode: "continue", backspace: true });
    const chars = Array.from(text);
    const teleprinter = page.locator('[data-machine][data-skin="teleprinter"]');
    await expect(teleprinter).toHaveCount(1);
    const layout = new Set(await keyList(page));
    const parts = await frame(page);
    const restStem = await keyCap(page, "q").evaluate((el) => getComputedStyle(el).boxShadow);
    await watchKeys(page);

    // C5 the cap moves by translate only, on the --motion-duration-fast token, its stem with it
    const token = await teleprinter.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--motion-duration-fast").trim(),
    );
    // 120ms in tokens.css; the CSS build may write it in seconds (`.12s`)
    const [, n, unit] = /^(\d*\.?\d+)(ms|s)$/.exec(token) ?? [];
    expect(Number(n) * (unit === "s" ? 1000 : 1), token).toBeCloseTo(120);
    const motion = await keyCap(page, "q").evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        property: s.transitionProperty,
        duration: s.transitionDuration,
        translate: s.translate,
        transform: s.transform,
      };
    });
    expect(motion).toEqual({
      property: "translate, box-shadow",
      duration: "0.12s",
      translate: "none",
      transform: "none",
    });

    // C4 every typed key: data-pressed on its cap, gone within 400 ms (the first word, then the space)
    const space = chars.indexOf(" ");
    expect(space, "a space in the text").toBeGreaterThan(0);
    for (const ch of chars.slice(0, space + 1)) {
      const key = ch.toLowerCase();
      // a repeated letter presses again only once the cap is back up: released, and its return transition
      // over (a press that reverses a running transition gets a shortened duration: CSS Transitions, faster reversing of interrupted transitions)
      await expect(machine(page).locator("[data-pressed]")).toHaveCount(0);
      if (layout.has(key)) {
        await expect
          .poll(() => keyCap(page, key).evaluate((el) => el.getAnimations().length), {
            message: `${JSON.stringify(ch)} at rest`,
          })
          .toBe(0);
      }
      // read the cap's running transitions on the next frame after the press: translate (down only, no
      // transform) and the stem's box-shadow, each on the fast token; the observer is in place before the
      // key goes down
      if (layout.has(key)) {
        await keyCap(page, key).evaluate((el) => {
          (window as unknown as { __mid: Promise<unknown> }).__mid = new Promise((resolve) => {
            const seen = new MutationObserver(() => {
              if (!el.hasAttribute("data-pressed")) return;
              seen.disconnect();
              requestAnimationFrame(() =>
                resolve({
                  transform: getComputedStyle(el).transform,
                  transitions: el
                    .getAnimations()
                    .filter((a): a is CSSTransition => a instanceof CSSTransition)
                    .map((a) => {
                      const effect = a.effect as KeyframeEffect;
                      const prop = a.transitionProperty;
                      const field = prop === "box-shadow" ? "boxShadow" : prop;
                      return {
                        prop,
                        duration: effect.getTiming().duration,
                        to: String(effect.getKeyframes().at(-1)?.[field]),
                      };
                    })
                    .sort((a, b) => a.prop.localeCompare(b.prop)),
                }),
              );
            });
            seen.observe(el, { attributes: true, attributeFilter: ["data-pressed"] });
          });
        });
      }
      await page.keyboard.press(keyName(ch));
      if (!layout.has(key)) continue; // a char this layout has no key for presses nothing
      const { on, off } = await pressOf(page, key);
      expect(off - on, `${JSON.stringify(ch)} held`).toBeLessThan(400);
      expect(off, `${JSON.stringify(ch)} released`).toBeLessThan(400);
      const mid = await page.evaluate(
        () =>
          (
            window as unknown as {
              __mid: Promise<{
                transform: string;
                transitions: { prop: string; duration: number; to: string }[];
              }>;
            }
          ).__mid,
      );
      expect(mid.transform, ch).toBe("none");
      expect(
        mid.transitions.map((t) => [t.prop, t.duration]),
        ch,
      ).toEqual([
        ["box-shadow", 120],
        ["translate", 120],
      ]);
      // the cap goes down (x 0, y > 0) and its stem shortens (a smaller vertical shadow offset)
      const [dx, dy] = mid.transitions[1]!.to.split(" ").map((v) => Number.parseFloat(v));
      expect([dx, dy! > 0], `${ch} -> ${mid.transitions[1]!.to}`).toEqual([0, true]);
      expect(stem(mid.transitions[0]!.to), `${ch} stem`).toBeLessThan(stem(restStem));
    }
    await expect(keyCap(page, " ")).not.toHaveAttribute("data-pressed", /.*/);
    expect((await keyLog(page)).marks.some((m) => m.key === " " && m.on)).toBe(true);
    expect(await frame(page), "a press leaves deck, slot and panel alone").toEqual(parts);

    // C4 a wrong key: data-wrong on that one cap until the next key; struck twice, it shakes twice
    const at = space + 1;
    const wrong = ["q", "z", "x", "j"].find(
      (k) => k !== chars[at]?.toLowerCase() && k !== chars[at + 1]?.toLowerCase(),
    )!;
    await page.keyboard.press(wrong);
    await expect(keyCap(page, wrong)).toHaveAttribute("data-wrong", "true");
    await expect(machine(page).locator("[data-wrong]")).toHaveCount(1);
    await expect.poll(async () => (await keyLog(page)).shakes).toEqual([wrong]);
    // C5 lkShake 0.4s once, over the typing-error cap; nothing else changes colour
    const shake = await keyCap(page, wrong).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        name: s.animationName,
        duration: s.animationDuration,
        iterations: s.animationIterationCount,
      };
    });
    expect(shake.name).toMatch(/lkShake/);
    expect([shake.duration, shake.iterations]).toEqual(["0.4s", "1"]);
    expect(await frame(page), "a wrong key leaves deck, slot and panel alone").toEqual(parts);
    for (const other of ["a", "s", "d"].filter((k) => k !== wrong)) {
      expect((await look(keyCap(page, other))).bg, other).toBe(INK);
    }
    await page.waitForTimeout(500);
    // after the shake the cap stays red with its paper legend
    const red = await look(keyCap(page, wrong));
    expect([red.bg, red.color]).toEqual([RED, PAPER]);

    await page.keyboard.press(wrong);
    await expect.poll(async () => (await keyLog(page)).shakes).toEqual([wrong, wrong]);
    await expect(machine(page).locator("[data-wrong]")).toHaveCount(1);
    await expect(keyCap(page, wrong)).toHaveAttribute("data-wrong", "true");

    // the next key (Backspace takes a struck char back) clears it; Backspace presses no cap
    await expect(machine(page).locator("[data-pressed]")).toHaveCount(0);
    const before = (await keyLog(page)).marks.filter((m) => m.attr === "data-pressed").length;
    await page.keyboard.press("Backspace");
    await expect(machine(page).locator("[data-wrong]")).toHaveCount(0);
    await page.waitForTimeout(300);
    const pressedMarks = (await keyLog(page)).marks.filter((m) => m.attr === "data-pressed");
    expect(pressedMarks.slice(before), "Backspace presses nothing").toEqual([]);

    // C4 Shift alone and a dead key (a synthetic keydown with key "Dead") set nothing
    const quiet = (await keyLog(page)).marks.length;
    await page.keyboard.press("Shift");
    await input(page).evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Dead", bubbles: true, cancelable: true }),
      ),
    );
    await page.waitForTimeout(300);
    expect((await keyLog(page)).marks.slice(quiet), "Shift and Dead").toEqual([]);
    await expect(machine(page).locator("[data-pressed], [data-wrong]")).toHaveCount(0);
  });

  for (const setting of ["prefers-reduced-motion", 'html data-motion="reduce"'] as const) {
    test(`C6 ${setting}: no transition, no shake, no cap moves; wrong, jammed and disabled keep their colours`, async ({
      page,
      browser,
    }) => {
      const reduce = async () => {
        if (setting === "prefers-reduced-motion")
          await page.emulateMedia({ reducedMotion: "reduce" });
        else
          await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
      };
      const { text } = await race(
        page,
        browser,
        { errorMode: "block", wordCount: 10 },
        setting === "prefers-reduced-motion" ? { before: reduce } : {},
      );
      if (setting !== "prefers-reduced-motion") await reduce();
      const chars = Array.from(text);
      const layout = new Set(await keyList(page));
      await watchKeys(page);
      await expect(machine(page)).toHaveAttribute("aria-hidden", "true");
      expect(
        await keyCap(page, "q").evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe("0s");
      expect(
        await keyCap(page, " ").evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe("0s");

      /** The key's box 50 ms after pressing `ch` equals its box before. */
      const still = async (ch: string, key: string) => {
        const box = await keyCap(page, key).boundingBox();
        await page.keyboard.press(keyName(ch));
        await page.waitForTimeout(50);
        expect(await keyCap(page, key).boundingBox(), `${JSON.stringify(ch)} moved`).toEqual(box);
      };

      // a wrong key (Block: refused, the machine jams): red, unshaken, unmoved
      const wrong = ["q", "z", "x"].find((k) => k !== chars[0]!.toLowerCase())!;
      await still(wrong, wrong);
      await expect(keyCap(page, wrong)).toHaveAttribute("data-wrong", "true");
      await expect(machine(page)).toHaveAttribute("data-jammed", "true");
      const struck = await keyCap(page, wrong).evaluate((el) => {
        const s = getComputedStyle(el);
        return { name: s.animationName, bg: s.backgroundColor, color: s.color };
      });
      expect(struck).toEqual({ name: "none", bg: RED, color: PAPER });
      expect((await look(keyCap(page, " "))).bg, "the jammed space bar").toBe(RED);
      const other = wrong === "q" ? "w" : "q";
      expect((await look(keyCap(page, other))).border, "a jammed outline").toBe(RED);

      // the right key releases the jam; its cap does not move either
      const first = chars[0]!;
      if (layout.has(first.toLowerCase())) await still(first, first.toLowerCase());
      else await page.keyboard.press(keyName(first));
      await expect(machine(page)).not.toHaveAttribute("data-jammed", /.*/);

      // the rest of the text: finished, every key disabled in its dashed outline
      await page.keyboard.type(chars.slice(1).join(""), { delay: 28 });
      await expect(input(page)).toBeDisabled();
      await expect(machine(page).locator("[data-disabled]")).toHaveCount(layout.size);
      const off = await look(keyCap(page, "q"));
      expect([off.bg, off.border, off.borderStyle]).toEqual(["rgba(0, 0, 0, 0)", METAL, "dashed"]);
      expect((await look(keyCap(page, " "))).borderStyle).toBe("dashed");
      // nothing was ever pressed down under reduced motion
      expect(
        (await keyLog(page)).marks.filter((m) => m.attr === "data-pressed" && m.on),
        "no press under reduced motion",
      ).toEqual([]);
      expect((await keyLog(page)).shakes, "no shake").toEqual([]);
    });
  }

  test("C7 finished: every key and the space bar disabled, a later key presses nothing", async ({
    page,
    browser,
  }) => {
    const { text } = await race(page, browser, { errorMode: "continue", wordCount: 10 });
    const layout = await keyList(page);
    await expect(machine(page).locator("[data-disabled]")).toHaveCount(0);
    await page.keyboard.type(text, { delay: 28 });
    await expect(input(page)).toBeDisabled();
    await expect(sheetChars(page)).toHaveCount(Array.from(text).length);
    await expect(machine(page).locator("[data-disabled]")).toHaveCount(layout.length);
    await expect(keyCap(page, " ")).toHaveAttribute("data-disabled", "true");
    await expect(machine(page).locator("[data-pressed], [data-wrong]")).toHaveCount(0);

    await watchKeys(page);
    for (const k of ["q", "Space", "e"]) await page.keyboard.press(k);
    await page.waitForTimeout(400);
    expect((await keyLog(page)).marks, "a key after the finish").toEqual([]);
    await expect(machine(page).locator("[data-disabled]")).toHaveCount(layout.length);
  });

  test("C7 touch: on a tablet, tapping a key types nothing and the race input keeps the focus", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: TABLET,
      hasTouch: true,
    });
    opened.push(context);
    const page = await context.newPage();
    await race(page, browser, { errorMode: "continue" });
    const typed = await sheetChars(page).count();
    await watchKeys(page);

    for (const key of ["q", "a", " "]) {
      await keyCap(page, key).tap();
      await expect(input(page), `after a tap on ${JSON.stringify(key)}`).toBeFocused();
    }
    await page.waitForTimeout(300);
    expect(await sheetChars(page).count(), "no span added to the sheet").toBe(typed);
    expect(await page.locator('[data-sheet] [data-state="done"]').count()).toBe(0);
    expect((await keyLog(page)).marks, "no keystroke").toEqual([]);
    await expect(input(page)).toHaveAttribute("data-errors", "0");
  });
});
