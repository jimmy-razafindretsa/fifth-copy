import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { createLobby, joinAsGuest, lobbyIdOf } from "./helpers";

// Contract of #214: the host's START (C8), the lobby -> seat view move with no line cut and the phase
// gate (C4), the 3-2-1 countdown and the GO stamp (C3), and its polite announcer (C5), live over the
// race server started by playwright.config.ts. Each page records what it showed with a MutationObserver
// installed before it loads (`record`): timings and computed styles are read where they happen, not
// after a Playwright round trip. Every test drives its own viewports, so only the desktop project runs.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COUNTDOWN_MS = 3_000;
const GO_STAMP_MS = 1_200;

type Box = { x: number; y: number; width: number; height: number };
type Phase = { t: number; path: string; phase: string | null };
type Step = {
  t: number;
  path: string;
  step: string | null;
  text: string | null;
  ru: string | null;
  anim: string | null;
  dur: string | null;
  fontSize: string | null;
  font: string | null;
  angle: string | null;
  tone: string | null;
  overlay: Box | null;
  mark: Box | null;
  telex: Box | null;
  sheet: Box | null;
};
type Said = {
  t: number;
  path: string;
  text: string | null;
  role: string | null;
  live: string | null;
};
type Log = { phases: Phase[]; steps: Step[]; said: Said[] };
type Frame = { t: number; payload: string };

/** Runs in the page before any of its scripts: logs every phase, countdown step and announcement. */
function recorder() {
  const log: Log = { phases: [], steps: [], said: [] };
  (window as unknown as { __countdown: Log }).__countdown = log;
  let phase: string | null = null;
  let step: string | null = null;
  let said: string | null = null;
  const box = (el: Element | null | undefined): Box | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const check = () => {
    const t = Date.now();
    const path = location.pathname;
    const p = document.querySelector("[data-seat-status] [data-phase]")?.getAttribute("data-phase");
    if ((p ?? null) !== phase) {
      phase = p ?? null;
      log.phases.push({ t, path, phase });
    }
    const overlay = document.querySelector("[data-countdown]");
    const s = overlay?.getAttribute("data-countdown") ?? null;
    if (s !== step) {
      step = s;
      const mark = overlay?.querySelector("[data-digit], [data-stamp-tone]");
      const cs = mark ? getComputedStyle(mark) : null;
      // the type is the digit's own, or the stamp's headline line
      const face = mark ? (mark.querySelector("span") ?? mark) : null;
      const fs = face ? getComputedStyle(face) : null;
      log.steps.push({
        t,
        path,
        step: s,
        text: mark?.textContent ?? null,
        ru: mark?.querySelector('[lang="ru"]')?.textContent ?? null,
        anim: cs?.animationName ?? null,
        dur: cs?.animationDuration ?? null,
        fontSize: fs?.fontSize ?? null,
        font: fs?.fontFamily ?? null,
        angle: mark?.getAttribute("data-stamp-angle") ?? null,
        tone: mark?.getAttribute("data-stamp-tone") ?? null,
        overlay: box(overlay),
        mark: box(mark),
        telex: box(document.querySelector("[data-telex]")),
        sheet: box(document.querySelector("[data-sheet]")),
      });
    }
    const announcer = document.querySelector("[data-announcer]");
    const text = announcer?.textContent ?? null;
    if (text !== said) {
      said = text;
      log.said.push({
        t,
        path,
        text,
        role: announcer?.getAttribute("role") ?? null,
        live: announcer?.getAttribute("aria-live") ?? null,
      });
    }
  };
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}

/** Every frame the page's sockets receive (lobby and seat view sockets alike), with its time. */
async function prepare(page: Page, frames: Frame[]) {
  await page.addInitScript(recorder);
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) =>
      frames.push({ t: Date.now(), payload: String(payload) }),
    ),
  );
}

const logOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __countdown: Log }).__countdown);
const start = (page: Page) => page.getByRole("button", { name: "START", exact: true });
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const phaseOf = (page: Page) => page.locator("[data-seat-status] [data-phase]");
const isLineCut = (f: Frame) => /^42\["event",\{[^}]*"kind":"line-cut"/.test(f.payload);
const raceIdIn = (frames: Frame[]) => {
  const frame = frames.find((f) => f.payload.startsWith('42["countdown"'));
  return frame ? /"raceId":"([^"]+)"/.exec(frame.payload)![1]! : null;
};
const disjoint = (a: Box, b: Box) =>
  a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/**
 * `next dev` compiles a route on its first request: warm the seat view and the race server's start
 * call, so the countdown's 3 s measure the race, not a compile (no-ops on a production build).
 */
async function warm(page: Page, lobbyId: string) {
  await page.request.get(`/race/${lobbyId}`);
  await page.request.post("/api/internal/races", { data: {} });
}

/** The steps a page showed on one path, in order (the recorder logs changes only). */
const stepsOn = (log: Log, path: string) => log.steps.filter((s) => s.path === path);

test.describe("#214 countdown and GO stamp", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  /** A host in its own context, waiting in a fresh private room, recording frames and the countdown. */
  async function hostRoom(browser: Browser) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    opened.push(context);
    const host = await context.newPage();
    const frames: Frame[] = [];
    await prepare(host, frames);
    const code = await createLobby(host);
    await expect(roll(host)).toBeVisible();
    return { host, frames, code, lobbyId: await lobbyIdOf(code) };
  }

  test("C8 only the host sees START: disabled alone with TWO TYPISTS NEEDED, enabled from two", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const code = await createLobby(page);
    await expect(roll(page).getByRole("listitem")).toHaveCount(1);
    const button = start(page);
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    const note = page.getByText("TWO TYPISTS NEEDED", { exact: true });
    await expect(note).toBeVisible();
    await expect(button).toHaveAttribute("aria-describedby", (await note.getAttribute("id"))!);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // under the roll, the bible 7.1 stamp button
    const rollBox = (await roll(page).boundingBox())!;
    expect((await button.boundingBox())!.y).toBeGreaterThan(rollBox.y + rollBox.height);
    const looks = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { font: s.fontFamily, border: s.borderTopWidth, shadow: s.boxShadow };
    });
    expect(looks.font).toMatch(/Stardos.?Stencil/i);
    expect(looks.border).toBe("3px");
    expect(looks.shadow).toMatch(/6px 6px 0px/);
    await expectNoA11yViolations(page);

    const guest = await joinAsGuest(browser, code);
    opened.push(guest.context);
    await expect(roll(guest.page).getByRole("listitem")).toHaveCount(2);
    await expect(start(guest.page)).toHaveCount(0);
    await expect(guest.page.getByText("TWO TYPISTS NEEDED")).toHaveCount(0);

    await expect(roll(page).getByRole("listitem")).toHaveCount(2);
    await expect(button).toBeEnabled();
    await expect(note).toHaveCount(0);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);
  });

  test("C4 C2 host and guest: START moves both to /race/<raceId>, no line cut, running 2.5-4 s after the click", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const hostFrames: Frame[] = [];
    await prepare(page, hostFrames);
    const code = await createLobby(page);
    const lobbyId = await lobbyIdOf(code);
    const guestFrames: Frame[] = [];
    const guest = await joinAsGuest(browser, code, {
      before: async (p) => {
        await p.setViewportSize({ width: 1024, height: 768 });
        await prepare(p, guestFrames);
      },
    });
    opened.push(guest.context);
    await expect(start(page)).toBeEnabled();
    await warm(page, lobbyId);

    const clickedAt = Date.now();
    await start(page).click();

    await expect.poll(() => raceIdIn(hostFrames)).not.toBeNull();
    const raceId = raceIdIn(hostFrames)!;
    expect(raceId).toMatch(UUID);
    expect(raceId).not.toBe(lobbyId);
    expect(raceIdIn(guestFrames)).toBe(raceId);

    for (const p of [page, guest.page]) {
      await expect(p).toHaveURL(new RegExp(`/race/${raceId}$`));
      await expect(p.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    }
    // one second after GO on both pages, then read what they saw
    await page.waitForTimeout(1_000);

    for (const [p, frames] of [
      [page, hostFrames],
      [guest.page, guestFrames],
    ] as const) {
      const log = await logOf(p);
      const path = `/race/${raceId}`;
      const phases = log.phases.filter((e) => e.path === path).map((e) => e.phase);
      // the seat view connected during the countdown and turned running at GO
      expect(phases).toContain("countdown");
      expect(phases.indexOf("countdown")).toBeLessThan(phases.indexOf("running"));
      const runningAt = log.phases.find((e) => e.path === path && e.phase === "running")!.t;
      const sinceClick = runningAt - clickedAt;
      expect(sinceClick, "running after the click").toBeGreaterThanOrEqual(2_500);
      expect(sinceClick, "running after the click").toBeLessThanOrEqual(4_000);
      for (const e of log.phases.filter((e) => e.path === path && e.t < runningAt)) {
        expect(e.phase).not.toBe("running");
      }
      // it showed the countdown on the seat view
      const shown = stepsOn(log, path).filter((s) => s.step !== null);
      expect(shown.length, "countdown steps on the seat view").toBeGreaterThan(0);
      expect(shown.at(-1)!.step).toBe("go");
      for (const s of shown) {
        expect(disjoint(s.overlay!, s.telex!), `${s.step} overlay vs telex`).toBe(true);
        expect(disjoint(s.overlay!, s.sheet!), `${s.step} overlay vs sheet`).toBe(true);
      }
      // no desk was line-cut, on the lobby socket or the seat view's, up to 1 s after GO
      const cut = frames.filter(
        (f) => f.t >= clickedAt && f.t <= runningAt + 1_000 && isLineCut(f),
      );
      expect(cut.map((f) => f.payload)).toEqual([]);
    }
    await expect(page.locator("[data-countdown]")).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test("C3 C5 a seat view open before the start: 3, 2, 1 slam in, the GO stamp lands at -6 degrees and leaves 1.2 s later, each announced", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(recorder);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(
      page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" }),
    ).toBeVisible();
    await expect(start(room.host)).toBeEnabled();
    await warm(room.host, room.lobbyId);

    await start(room.host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "countdown");
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    await expect(page.locator("[data-countdown]")).toHaveCount(0, { timeout: 5_000 });

    const log = await logOf(page);
    const path = `/race/${room.lobbyId}`;
    const steps = stepsOn(log, path);
    expect(steps.map((s) => s.step)).toEqual(["3", "2", "1", "go", null]);
    const [three, two, one, go, gone] = steps as [Step, Step, Step, Step, Step];

    // the digits: the display-lg role (Stardos 700, 3.5rem), each slamming in on the slam token
    for (const digit of [three, two, one]) {
      expect(digit.text).toBe(digit.step);
      expect(digit.fontSize).toBe("56px");
      expect(digit.font).toMatch(/Stardos.?Stencil/i);
      expect(digit.anim).toMatch(/fcSlam$/);
      expect(digit.dur).toBe("0.35s");
    }
    // one second apart on the server clock
    for (const [a, b] of [
      [three, two],
      [two, one],
      [one, go],
    ] as const) {
      expect(b.t - a.t).toBeGreaterThanOrEqual(850);
      expect(b.t - a.t).toBeLessThanOrEqual(1_150);
    }
    // GO: the red stamp, НАЧАЛИ · GO, a fixed -6 degrees, slamming, gone 1.2 s after GO
    expect(go.text).toBe("НАЧАЛИ · GO");
    expect(go.ru).toBe("НАЧАЛИ");
    expect(go.tone).toBe("red");
    expect(go.angle).toBe("-6");
    expect(go.fontSize).toBe("56px");
    expect(go.anim).toMatch(/fcSlam$/);
    expect(gone.t - go.t).toBeGreaterThanOrEqual(GO_STAMP_MS - 150);
    expect(gone.t - go.t).toBeLessThanOrEqual(GO_STAMP_MS + 150);
    // GO is the instant the phase turns running
    const runningAt = log.phases.find((e) => e.path === path && e.phase === "running")!.t;
    expect(Math.abs(go.t - runningAt)).toBeLessThanOrEqual(150);
    // the whole countdown fits the server's 3 s (the offset from the welcome is off by the latency)
    expect(go.t - three.t).toBeLessThanOrEqual(COUNTDOWN_MS + 150);

    // centred over the scene area: on the typing surface's axis, between the strip and the sheet,
    // and the overlay never covers either
    for (const s of [three, two, one, go]) {
      const mark = centre(s.mark!);
      const sheet = centre(s.sheet!);
      expect(Math.abs(mark.x - sheet.x), `${s.step} on the surface's axis`).toBeLessThanOrEqual(2);
      expect(mark.y).toBeGreaterThan(s.telex!.y + s.telex!.height);
      expect(mark.y).toBeLessThan(s.sheet!.y);
      const overlay = centre(s.overlay!);
      expect(Math.abs(mark.y - overlay.y), `${s.step} centred in the overlay`).toBeLessThanOrEqual(
        2,
      );
      expect(disjoint(s.overlay!, s.telex!), `${s.step} overlay vs telex`).toBe(true);
      expect(disjoint(s.overlay!, s.sheet!), `${s.step} overlay vs sheet`).toBe(true);
    }

    // C5: one polite status region says 3, 2, 1, GO
    const said = log.said.filter((e) => e.path === path && e.text);
    expect(said.map((e) => e.text)).toEqual(["3", "2", "1", "GO"]);
    for (const e of said) {
      expect(e.role).toBe("status");
      expect(e.live).not.toBe("assertive");
    }
    await expectNoA11yViolations(page);
  });

  test("C3 C5 reduced motion, Night shift, tablet: the digits and the stamp simply appear", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await page.addInitScript(recorder);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(
      page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" }),
    ).toBeVisible();
    await expect(start(room.host)).toBeEnabled();
    await warm(room.host, room.lobbyId);

    await start(room.host).click();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", { timeout: 10_000 });
    await expect(page.locator("[data-countdown]")).toHaveCount(0, { timeout: 5_000 });

    const log = await logOf(page);
    const path = `/race/${room.lobbyId}`;
    const steps = stepsOn(log, path);
    expect(steps.map((s) => s.step)).toEqual(["3", "2", "1", "go", null]);
    for (const s of steps.slice(0, 4)) {
      expect(s.anim, `${s.step} under reduced motion`).toBe("none");
      expect(disjoint(s.overlay!, s.telex!), `${s.step} overlay vs telex`).toBe(true);
      expect(disjoint(s.overlay!, s.sheet!), `${s.step} overlay vs sheet`).toBe(true);
    }
    expect(steps[3]!.angle).toBe("-6");
    expect(log.said.filter((e) => e.path === path && e.text).map((e) => e.text)).toEqual([
      "3",
      "2",
      "1",
      "GO",
    ]);
  });
});
