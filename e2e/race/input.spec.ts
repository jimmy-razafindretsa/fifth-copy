import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { hostRoom, phaseOf, startButton, warmRace } from "./helpers";

// Contract of #559 C4 (the hidden input: aids off, locked until GO and after the finish, focused at GO
// and on a press inside the typing surface, only printable keys and Backspace), C7 (paste, copy and drop
// give nothing) and C10 (moved in from #214: a key during the countdown types nothing and sends no `keys`
// frame; once running, one key is one `done` span and one `keys` frame of one keystroke), live over the
// race server started by playwright.config.ts. The page under test visits `/race/<lobbyId>` alone (the
// host waits in its own context), so every frame it sends is the seat view's.

type Frame = { t: number; payload: string };

const input = (page: Page) => page.getByRole("textbox", { name: "Text to type" });
const sheet = (page: Page, state: string) => page.locator(`[data-sheet] [data-state="${state}"]`);
const strip = (page: Page, state: string) => page.locator(`[data-telex] [data-state="${state}"]`);
const keysFrames = (frames: Frame[]) => frames.filter((f) => f.payload.startsWith('42["keys",'));
const batchOf = (f: Frame) =>
  (JSON.parse(f.payload.slice(2)) as [string, { batch: { t: number; key: string }[] }])[1].batch;

/** `keyboard.press` names the space bar `Space`; any other char presses as itself. */
const keyName = (ch: string) => (ch === " " ? "Space" : ch);

/** The race text as the strip shows it, one char per span. */
async function textOf(page: Page): Promise<string> {
  return (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
}

test.describe("#559 race input", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /** The page takes a desk at `/race/<lobbyId>` in a fresh room; returns the room and its sent frames. */
  async function seat(page: Page, browser: import("@playwright/test").Browser) {
    const room = await hostRoom(browser, opened);
    await page.setViewportSize({ width: 1280, height: 800 });
    const sent: Frame[] = [];
    page.on("websocket", (ws) =>
      ws.on("framesent", ({ payload }) => sent.push({ t: Date.now(), payload: String(payload) })),
    );
    await page.goto(`/race/${room.lobbyId}`);
    await expect(
      page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" }),
    ).toBeVisible();
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    return { ...room, sent };
  }

  async function startRace(page: Page, host: Page) {
    await startButton(host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "countdown");
  }

  test("C10 a key during the countdown types nothing and sends no keys frame; once running one key is one done span and one keys frame of one keystroke", async ({
    page,
    browser,
  }) => {
    const room = await seat(page, browser);
    await startRace(page, room.host);
    // the strip holds the race text during the countdown
    await expect(strip(page, "next")).toHaveCount(1);
    const first = (await textOf(page))[0]!;

    await page.keyboard.press(keyName(first));
    await page.waitForTimeout(300);
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "countdown");
    await expect(sheet(page, "done")).toHaveCount(0);
    expect(keysFrames(room.sent), "no keys frame before running").toEqual([]);

    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    const runningAt = Date.now();
    await expect(input(page)).toBeFocused();
    await page.keyboard.press(keyName(first));
    await expect(sheet(page, "done")).toHaveCount(1);
    await expect(strip(page, "done")).toHaveCount(1);
    await expect.poll(() => keysFrames(room.sent).length).toBe(1);
    await page.waitForTimeout(300);
    const frames = keysFrames(room.sent);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.t).toBeGreaterThanOrEqual(runningAt);
    const batch = batchOf(frames[0]!);
    expect(batch).toHaveLength(1);
    expect(batch[0]!.key).toBe(first);
    expect(Number.isInteger(batch[0]!.t)).toBe(true);
    expect(batch[0]!.t).toBeGreaterThanOrEqual(0);
  });

  test("C4 the hidden input: aids off, locked until GO, focused at GO and on a press inside the typing surface, only printable keys and Backspace, locked after the finish", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);
    const room = await seat(page, browser);
    const field = input(page);
    await expect(field).toHaveAttribute("autocomplete", "off");
    await expect(field).toHaveAttribute("autocorrect", "off");
    await expect(field).toHaveAttribute("autocapitalize", "off");
    await expect(field).toHaveAttribute("spellcheck", "false");
    await expect(field).toHaveAttribute("inputmode", "text");
    // visually hidden: in the page, taking no room
    const box = (await field.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    await expect(field).toBeDisabled();

    await startRace(page, room.host);
    await expect(field).toBeDisabled();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    await expect(field).toBeEnabled();
    await expect(field).toBeFocused();
    await expectNoA11yViolations(page);

    const text = await textOf(page);
    // anything but a printable key or Backspace is ignored
    for (const key of ["Shift", "Enter", "Escape", "ArrowRight", "ArrowLeft", "F2", "Control+a"]) {
      await page.keyboard.press(key);
    }
    await expect(field).toBeFocused();
    await expect(sheet(page, "done")).toHaveCount(0);
    await expect(sheet(page, "next")).toHaveCount(1);
    // a right key, a wrong one, Backspace takes it back
    await page.keyboard.press(keyName(text[0]!));
    await expect(sheet(page, "done")).toHaveCount(1);
    const wrong = text[1] === "#" ? "%" : "#";
    await page.keyboard.press(wrong);
    await expect(sheet(page, "wrong")).toHaveCount(1);
    await page.keyboard.press("Backspace");
    await expect(sheet(page, "wrong")).toHaveCount(0);
    await expect(sheet(page, "done")).toHaveCount(1);
    await expect(field).toHaveValue("");

    // the focus leaves with a press elsewhere and comes back with a press on the surface
    for (const part of ["[data-sheet]", "[data-telex]", "[data-machine]"]) {
      await page.getByRole("heading", { level: 1 }).click();
      await expect(field).not.toBeFocused();
      await page.locator(part).click();
      await expect(field, part).toBeFocused();
    }

    // the rest of the text, at a human pace (the server's budget is 40 keys a second)
    await page.keyboard.type(text.slice(1), { delay: 28 });
    await expect(sheet(page, "done")).toHaveCount(Array.from(text).length);
    await expect(field).toBeDisabled();
    await expect.poll(() => keysFrames(room.sent).flatMap(batchOf).length).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const before = keysFrames(room.sent).length;
    await page.keyboard.press("x");
    await page.waitForTimeout(300);
    expect(keysFrames(room.sent)).toHaveLength(before);
    await expect(sheet(page, "done")).toHaveCount(Array.from(text).length);
  });

  test("C7 pasting the text adds nothing, copying the strip yields an empty clipboard, a drop on the strip is ignored", async ({
    page,
    browser,
  }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const room = await seat(page, browser);
    await startRace(page, room.host);
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    await expect(input(page)).toBeFocused();
    const text = await textOf(page);
    // the clipboard events the page sees: the shortcuts below really paste and copy
    await page.evaluate(() => {
      const seen = { paste: 0, copy: 0 };
      (window as unknown as { __clipboard: typeof seen }).__clipboard = seen;
      document.addEventListener("paste", () => void seen.paste++, true);
      document.addEventListener("copy", () => void seen.copy++, true);
    });
    const seen = () =>
      page.evaluate(
        () => (window as unknown as { __clipboard: { paste: number; copy: number } }).__clipboard,
      );

    // paste the whole text into the focused input
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.keyboard.press("ControlOrMeta+V");
    await expect.poll(async () => (await seen()).paste).toBe(1);
    await page.waitForTimeout(300);
    await expect(sheet(page, "done")).toHaveCount(0);
    await expect(sheet(page, "wrong")).toHaveCount(0);
    await expect(input(page)).toHaveValue("");

    // select the strip (and the sheet), copy: the clipboard holds nothing
    for (const part of ["[data-telex]", "[data-sheet]"]) {
      await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
      await page.locator(part).evaluate((el) => window.getSelection()!.selectAllChildren(el));
      await page.keyboard.press("ControlOrMeta+C");
      expect(await page.evaluate(() => navigator.clipboard.readText()), part).toBe("");
    }
    expect((await seen()).copy).toBe(2);

    // drag text from elsewhere onto the strip
    await page.evaluate(
      (t) => {
        const source = document.createElement("p");
        source.id = "drag-source";
        source.textContent = t;
        source.style.cssText = "position:fixed;left:8px;top:8px;z-index:99;background:canvas";
        source.draggable = true;
        source.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/plain", t));
        document.body.append(source);
      },
      text.slice(0, 12),
    );
    await page.locator("#drag-source").dragTo(page.locator("[data-telex]"));
    await page.waitForTimeout(300);
    await expect(sheet(page, "done")).toHaveCount(0);
    await expect(strip(page, "done")).toHaveCount(0);
    expect(keysFrames(room.sent), "nothing typed, nothing sent").toEqual([]);

    // typing still works after all of it
    await page.locator("[data-telex]").click();
    await page.keyboard.press(keyName(text[0]!));
    await expect(sheet(page, "done")).toHaveCount(1);
  });
});
