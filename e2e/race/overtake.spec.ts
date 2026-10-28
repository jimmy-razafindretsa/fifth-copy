import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { scaled } from "../timeouts";
import { hostRoom, phaseOf, startButton, warmRace } from "./helpers";

// Contract of #232 C2, C3, C4: the overtake stamps live over the race server started by
// playwright.config.ts. Host and one guest; the guest takes its desk from the seat view itself, so it
// sits after the host and ranks behind it at the start (ties rank by desk). After GO the guest types
// the first characters of the strip and passes the idle host: the guest sees the red
// `ОБГОН! · OVERTAKE +1`, the host the ink `ОБОГНАЛИ · PASSED −1`. Each page records what it showed with
// a MutationObserver installed before it loads (times, computed styles and boxes are read where they
// happen); the server's `event` frames are timed in Node on the same machine clock. Every test drives
// its own viewports, so only the desktop project runs.

const SHOW_MS = 1_400;

type Box = { x: number; y: number; width: number; height: number };
type Shown = {
  t: number;
  kind: string | null;
  text: string | null;
  ru: string | null;
  tone: string | null;
  size: string | null;
  angle: string | null;
  anim: string | null;
  row: Box | null;
  telex: Box | null;
  sheet: Box | null;
};
type Log = { shown: Shown[]; said: { t: number; text: string; role: string | null }[] };
type Frame = { t: number; payload: string };

/** Runs in each page before its scripts: logs every stamp change and every announcer text. */
function recorder() {
  const log: Log = { shown: [], said: [] };
  (window as unknown as { __stamps: Log }).__stamps = log;
  const box = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  let current: Element | null = null;
  let said: string | null = null;
  const check = () => {
    const t = Date.now();
    const row = document.querySelector("[data-stamps]");
    const mark = row?.querySelector("[data-stamp-tone]") ?? null;
    if (mark !== current) {
      current = mark;
      log.shown.push({
        t,
        kind: row?.getAttribute("data-stamps") ?? null,
        text: mark?.textContent ?? null,
        ru: mark?.querySelector('[lang="ru"]')?.textContent ?? null,
        tone: mark?.getAttribute("data-stamp-tone") ?? null,
        size: mark?.getAttribute("data-stamp-size") ?? null,
        angle: mark?.getAttribute("data-stamp-angle") ?? null,
        anim: mark ? getComputedStyle(mark).animationName : null,
        row: box(row),
        telex: box(document.querySelector("[data-telex]")),
        sheet: box(document.querySelector("[data-sheet]")),
      });
    }
    const announcer = document.querySelector("[data-announcer]");
    const text = announcer?.textContent ?? null;
    if (text !== said) {
      said = text;
      if (text) log.said.push({ t, text, role: announcer!.getAttribute("role") });
    }
  };
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}

const logOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __stamps: Log }).__stamps);
const deskOf = async (page: Page) =>
  /(\d{2})$/.exec((await page.getByRole("heading", { level: 1 }).textContent())!)![1]!;
const disjoint = (a: Box, b: Box) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const eventFrame = (kind: string) => (f: Frame) =>
  f.payload.startsWith('42["event"') && f.payload.includes(`"kind":"${kind}"`);

/** Records the frames every socket of the page receives, with their time, and the stamp log. */
async function prepare(page: Page, frames: Frame[]) {
  await page.addInitScript(recorder);
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) =>
      frames.push({ t: Date.now(), payload: String(payload) }),
    ),
  );
}

type Setup = {
  width: number;
  height: number;
  colorScheme?: "light" | "dark";
  reducedMotion?: "reduce" | "no-preference";
  /** The guest's UI language (the host stays in English). */
  guestLocale?: "en" | "fr";
};

test.describe("#232 overtake stamps", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /** Host and guest at one viewport; the guest passes the host after GO. Returns both logs. */
  async function race(page: Page, browser: Parameters<typeof hostRoom>[0], setup: Setup) {
    const media = { colorScheme: setup.colorScheme, reducedMotion: setup.reducedMotion };
    const hostFrames: Frame[] = [];
    const guestFrames: Frame[] = [];
    const room = await hostRoom(browser, opened, {
      before: async (host) => {
        await host.setViewportSize({ width: setup.width, height: setup.height });
        await host.emulateMedia(media);
        await prepare(host, hostFrames);
      },
    });
    await page.setViewportSize({ width: setup.width, height: setup.height });
    await page.emulateMedia(media);
    if (setup.guestLocale === "fr") {
      await page
        .context()
        .addCookies([{ name: "locale", value: "fr", url: test.info().project.use.baseURL! }]);
    }
    await prepare(page, guestFrames);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/\d{2}$/);
    const guestDesk = await deskOf(page);
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);

    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    await expect(room.host.getByRole("heading", { level: 1 })).toHaveText(/\d{2}$/);
    const hostDesk = await deskOf(room.host);
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
      // the GO stamp leaves first (bible 8: one stamp at a time)
      await expect(p.locator("[data-countdown]")).toHaveCount(0, { timeout: scaled(5_000) });
    }
    await expect(
      page.getByRole("textbox", { name: /^(Text to type|Texte à taper)$/ }),
    ).toBeFocused();

    const text = (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
    await page.keyboard.type(Array.from(text).slice(0, 3).join(""));

    await expect(page.locator("[data-stamps]")).toHaveAttribute("data-stamps", "overtake", {
      timeout: scaled(5_000),
    });
    await expect(room.host.locator("[data-stamps]")).toHaveAttribute("data-stamps", "passed", {
      timeout: scaled(5_000),
    });
    // both leave on their own
    await expect(page.locator("[data-stamps]")).toHaveCount(0, { timeout: scaled(5_000) });
    await expect(room.host.locator("[data-stamps]")).toHaveCount(0, { timeout: scaled(5_000) });

    return {
      room,
      guestDesk,
      hostDesk,
      guest: { log: await logOf(page), frames: guestFrames },
      host: { log: await logOf(room.host), frames: hostFrames },
    };
  }

  /** The first stamp a page showed and the moment it left. */
  function firstStamp(log: Log) {
    const i = log.shown.findIndex((s) => s.kind !== null);
    expect(i, "a stamp showed").toBeGreaterThanOrEqual(0);
    const gone = log.shown.slice(i + 1).find((s) => s.kind === null);
    return { stamp: log.shown[i]!, gone };
  }

  function expectClearOfTheSurface(s: Shown, label: string) {
    expect(disjoint(s.row!, s.telex!), `${label} row vs telex`).toBe(true);
    expect(disjoint(s.row!, s.sheet!), `${label} row vs sheet`).toBe(true);
    expect(s.row!.height, `${label} row has room`).toBeGreaterThan(0);
  }

  test("C2 C3 C4 desktop: the guest sees OVERTAKE +1, the host PASSED −1, within 1 s of the event, each announced", async ({
    page,
    browser,
  }) => {
    const { room, guestDesk, hostDesk, guest, host } = await race(page, browser, {
      width: 1280,
      height: 800,
    });

    const mine = firstStamp(guest.log);
    expect(mine.stamp.kind).toBe("overtake");
    expect(mine.stamp.text).toBe("ОБГОН! · OVERTAKE +1");
    expect(mine.stamp.ru).toBe("ОБГОН!");
    expect(mine.stamp.tone).toBe("red");
    expect(mine.stamp.size).toBe("md");
    expect(Math.abs(Number(mine.stamp.angle))).toBeGreaterThanOrEqual(2);
    expect(Math.abs(Number(mine.stamp.angle))).toBeLessThanOrEqual(6);
    expect(mine.stamp.anim).toMatch(/fcSlam$/);
    expectClearOfTheSurface(mine.stamp, "overtake");

    const theirs = firstStamp(host.log);
    expect(theirs.stamp.kind).toBe("passed");
    expect(theirs.stamp.text).toBe("ОБОГНАЛИ · PASSED −1");
    expect(theirs.stamp.tone).toBe("ink");
    expectClearOfTheSurface(theirs.stamp, "passed");

    // C3: each within 1 s of its server event; then gone 1.4 s after it showed
    const overtakeAt = guest.frames.find(eventFrame("overtake"))?.t;
    const passedAt = host.frames.find(eventFrame("passed"))?.t;
    expect(overtakeAt, "the guest's overtake event").toBeDefined();
    expect(passedAt, "the host's passed event").toBeDefined();
    test.info().annotations.push({
      type: "timing",
      description: `overtake ${mine.stamp.t - overtakeAt!} ms, passed ${theirs.stamp.t - passedAt!} ms after the event`,
    });
    expect(mine.stamp.t - overtakeAt!, "overtake after its event (ms)").toBeLessThanOrEqual(1_000);
    expect(theirs.stamp.t - passedAt!, "passed after its event (ms)").toBeLessThanOrEqual(1_000);
    for (const { stamp, gone } of [mine, theirs]) {
      expect(gone, "the stamp left").toBeDefined();
      expect(gone!.t - stamp.t).toBeGreaterThanOrEqual(SHOW_MS - 150);
      expect(gone!.t - stamp.t).toBeLessThanOrEqual(SHOW_MS + 300);
    }

    // C4: the polite status region of #214 says who passed whom
    const said = (log: Log, text: string) => log.said.find((e) => e.text === text);
    expect(said(guest.log, `You passed desk ${hostDesk}`)?.role).toBe("status");
    expect(said(host.log, `Desk ${guestDesk} passed you`)?.role).toBe("status");
    await expectNoA11yViolations(page);
    await expectNoA11yViolations(room.host);
  });

  test("C2 laptop, reduced motion: the stamps simply appear and leave, clear of the strip and the sheet", async ({
    page,
    browser,
  }) => {
    const { guest, host } = await race(page, browser, {
      width: 1024,
      height: 768,
      reducedMotion: "reduce",
    });
    for (const [log, kind] of [
      [guest.log, "overtake"],
      [host.log, "passed"],
    ] as const) {
      const { stamp, gone } = firstStamp(log);
      expect(stamp.kind).toBe(kind);
      expect(stamp.anim, `${kind} under reduced motion`).toBe("none");
      expect(gone, `${kind} left`).toBeDefined();
      expectClearOfTheSurface(stamp, kind);
    }
  });

  test("C2 tablet, Night shift, French guest: one language besides the Russian, clear of the strip and the sheet", async ({
    page,
    browser,
  }) => {
    const { guestDesk, hostDesk, guest, host } = await race(page, browser, {
      width: 768,
      height: 1024,
      colorScheme: "dark",
      guestLocale: "fr",
    });
    const mine = firstStamp(guest.log);
    expect(mine.stamp.text).toBe("ОБГОН! · DÉPASSEMENT +1");
    expect(mine.stamp.tone).toBe("red");
    expectClearOfTheSurface(mine.stamp, "overtake");
    expect(guest.log.said.map((e) => e.text)).toContain(`Tu as dépassé le bureau ${hostDesk}`);
    const theirs = firstStamp(host.log);
    expect(theirs.stamp.text).toBe("ОБОГНАЛИ · PASSED −1");
    expectClearOfTheSurface(theirs.stamp, "passed");
    expect(host.log.said.map((e) => e.text)).toContain(`Desk ${guestDesk} passed you`);
  });
});
