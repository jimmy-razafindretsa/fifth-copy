import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { closeLobby, createLobby, lobbyIdOf, roomlessLobbyLike } from "./helpers";

// Contract of #561: the seat view `/race/[raceId]` (C1, C4, C5, C6, C11 in the browser), live over the
// race server started by playwright.config.ts. A host keeps the room open in its own context; the page
// under test is a second guest opening the seat view directly, so it joins the waiting room as a player.
// Every test drives its own viewports, so only the desktop project runs them.

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;
const UNKNOWN_RACE = "16fd2706-8baf-433b-82eb-8c7fada847da";
const UNKNOWN_LOBBY = "cmuvumv5q002f0fr7b6mgzfcf";
const LAYOUTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
] as const;

const isRaceAction = (method: string, url: string, headers: Record<string, string>) =>
  method === "POST" && new URL(url).pathname.startsWith("/race/") && !!headers["next-action"];
const notice = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const lostLine = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });

/** A host opens a private race in its own context and stays in the waiting room (the room stays open). */
async function hostRoom(browser: Browser) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const host = await context.newPage();
  const code = await createLobby(host);
  await expect(host.getByRole("list", { name: "Typists in the room" })).toBeVisible();
  return { context, code, lobbyId: await lobbyIdOf(code) };
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
const disjoint = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

/** The HUD parts C5 keeps on screen. */
const HUD = {
  kicker: (p: Page) => p.getByRole("heading", { level: 1 }),
  telex: (p: Page) => p.locator("[data-telex]"),
  nixie: (p: Page) => p.locator('[data-device="nixie"]'),
  raceCard: (p: Page) => p.locator("[data-race-card]"),
  notice: (p: Page) => p.locator("[data-seat-status] [data-notice]"),
  sheet: (p: Page) => p.locator("[data-sheet]"),
  machine: (p: Page) => p.locator("[data-machine]"),
  tray: (p: Page) => p.locator("[data-sabotage-tray]"),
  abandon: (p: Page) => p.locator("[data-abandon]"),
};

test.describe("#561 seat view shell", () => {
  test.skip(
    ({ viewport }) => viewport?.width !== 1280,
    "desktop project; tests set their viewports",
  );

  let host: BrowserContext | null = null;
  test.afterEach(async () => {
    await host?.close();
    host = null;
  });

  test("C1 a malformed or unknown id is a 404", async ({ request }) => {
    for (const id of [UNKNOWN_RACE, UNKNOWN_LOBBY, "not-a-race", "KGB-4821"]) {
      expect((await request.get(`/race/${id}`)).status(), id).toBe(404);
    }
  });

  test("C4 C6 C11 the server renders the before-start seat; the leaf connects and waits for the host", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser);
    host = room.context;

    // the server's HTML, before any script: the whole HUD in its before-start state, connecting
    const html = await (await page.request.get(`/race/${room.lobbyId}`)).text();
    for (const part of [
      'data-backdrop="paper"',
      "data-telex",
      "data-sheet",
      'data-machine="true"',
      'data-device="nixie"',
      "data-race-card",
      "data-sabotage-tray",
      'data-abandon="disabled"',
      'aria-busy="true"',
      ">SEAT VIEW</h1>",
    ]) {
      expect(html, part).toContain(part);
    }

    // the handshake carries the stored resume key (C11): seed one, then watch the frames
    const seeded = "s".repeat(40);
    await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [
      `fifth-copy:resume:${room.lobbyId}`,
      seeded,
    ] as const);
    const sent: string[] = [];
    page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
    const tokens: string[] = [];
    await page.route("**/race/**", async (route) => {
      const r = route.request();
      if (!isRaceAction(r.method(), r.url(), r.headers())) return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      tokens.push(...(JWT.exec(body) ?? []));
      await route.fulfill({ response, body });
    });

    await page.goto(`/race/${room.lobbyId}`);
    await expect(notice(page, "WAITING FOR THE HOST")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
    await expect(
      page.getByRole("group", { name: "Words per minute 0, 2 typists, no place yet" }),
    ).toBeVisible();
    await expect(page.locator("[data-tube]")).toHaveText(["00", "00 / 02"]);
    const card = page.getByRole("region", { name: "RACE CARD" });
    await expect(card).toContainText("2 TYPISTS");
    await expect(card.locator("[data-tick]")).toHaveCount(2);
    await expect(card.locator('[data-tick][data-you="true"]')).toHaveCount(1);
    await expect(page.getByRole("region", { name: "SABOTAGE TRAY" })).toContainText("NO CARD");
    await expect(page.getByRole("button", { name: "ABANDON" })).toBeDisabled();
    await expect(page.getByRole("group", { name: "Text to type" })).toBeVisible();
    await expect(page.locator("[data-machine]")).toBeVisible();
    await expect(page.locator('ul[aria-busy="true"]')).toHaveCount(0);

    // C11: the key went in the handshake auth only; the server's own key replaced it in storage
    const connect = sent.find((f) => f.includes(seeded));
    expect(connect, "the stored key in the handshake").toBeDefined();
    expect(connect).toMatch(/"token":"eyJ/);
    expect(page.url()).not.toContain(seeded);
    const stored = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `fifth-copy:resume:${room.lobbyId}`,
    );
    expect(stored).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    expect(stored).not.toBe(seeded);

    // ADR 0009: the token stays out of the URL, the HTML and cookies
    expect(tokens.length, "the action response carries the token").toBeGreaterThan(0);
    expect(
      sent.some((f) => tokens.some((t) => f.includes(t))),
      "token in the handshake",
    ).toBe(true);
    const live = await page.content();
    const cookies = await page.context().cookies();
    for (const token of tokens) {
      expect(page.url()).not.toContain(token);
      expect(live).not.toContain(token);
      for (const cookie of cookies) expect(cookie.value, cookie.name).not.toContain(token);
    }

    // C6 / C8: accessible in both themes; the waiting notice holds still under reduced motion
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoA11yViolations(page);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    const still = await notice(page, "WAITING FOR THE HOST").evaluate(
      (el) => getComputedStyle(el).animationName,
    );
    expect(still).toBe("none");
  });

  test("C4 connecting: skeleton rows while the token is minted", async ({ page, browser }) => {
    const room = await hostRoom(browser);
    host = room.context;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/race/**", async (route) => {
      const r = route.request();
      if (isRaceAction(r.method(), r.url(), r.headers())) await gate;
      await route.continue();
    });
    await page.goto(`/race/${room.lobbyId}`);
    const busy = page.getByRole("list", { name: "Taking your seat…" });
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(busy.locator("li")).toHaveCount(2);
    const backgrounds = await busy
      .locator("li *")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundImage));
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const bg of backgrounds) expect(bg).not.toContain("gradient");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("SEAT VIEW");
    release();
    await expect(notice(page, "WAITING FOR THE HOST")).toBeVisible();
    await expect(page.locator('ul[aria-busy="true"]')).toHaveCount(0);
  });

  test("C4 reconnecting: a cut line shows the pulsing line-cut notice", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser);
    host = room.context;
    const sockets: { close(): Promise<void> }[] = [];
    // the first socket reaches the server; later attempts hang, so the page stays reconnecting
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
      if (sockets.length === 0) ws.connectToServer();
      sockets.push(ws);
    });
    await page.goto(`/race/${room.lobbyId}`);
    await expect(notice(page, "WAITING FOR THE HOST")).toBeVisible();
    await sockets[0]!.close();
    const cut = notice(page, "LINE CUT · RECONNECTING");
    await expect(cut).toBeVisible({ timeout: 10_000 });
    expect(await cut.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/lkPulse$/);
    // the HUD keeps what it knew
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
  });

  test("C4 lost: a room that is gone, then a closed race, each with the way back", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser);
    host = room.context;
    const gone = await roomlessLobbyLike(room.code);

    await page.goto(`/race/${gone.id}`);
    await expect(lostLine(page, "This room is no longer open.")).toBeVisible();
    await expect(lostLine(page, "RETURNED ·")).toBeVisible();
    const back = page.getByRole("link", { name: "BACK TO THE WAITING ROOM →" });
    await expect(back).toHaveAttribute("href", `/lobby/${gone.code}`);
    expect((await box(back)).height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('[data-seat-status] [role="status"]')).toHaveCount(0);

    await closeLobby(gone.code);
    await page.goto(`/race/${gone.id}`);
    await expect(lostLine(page, "This race is closed.")).toBeVisible();
    await expect(page.getByRole("link", { name: "BACK TO THE WAITING ROOM →" })).toHaveAttribute(
      "href",
      `/lobby/${gone.code}`,
    );
    await expectNoA11yViolations(page);
  });

  test("C5 at 1280, 1024 and 768 the race card never meets the machine and the HUD stays on screen", async ({
    page,
    browser,
  }) => {
    const room = await hostRoom(browser);
    host = room.context;
    await page.goto(`/race/${room.lobbyId}`);
    await expect(notice(page, "WAITING FOR THE HOST")).toBeVisible();
    for (const size of LAYOUTS) {
      await page.setViewportSize(size);
      await expect(page.locator("[data-phones]")).toBeHidden();
      const card = await box(HUD.raceCard(page));
      const machine = await box(HUD.machine(page));
      expect(disjoint(card, machine), `${size.width}: race card vs machine`).toBe(true);
      for (const [name, locate] of Object.entries(HUD)) {
        const b = await box(locate(page));
        const at = `${size.width}x${size.height} ${name}`;
        expect(b.x, at).toBeGreaterThanOrEqual(0);
        expect(b.y, at).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, at).toBeLessThanOrEqual(size.width + 0.5);
        expect(b.y + b.height, at).toBeLessThanOrEqual(size.height + 0.5);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${size.width}: horizontal scroll`).toBeLessThanOrEqual(0);
    }
  });

  test("C5 phones (<= 480 px) see only the notice and never take a desk", async ({ page }) => {
    const code = await createLobby(page);
    const lobbyId = await lobbyIdOf(code);
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    for (const width of [375, 480]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/race/${lobbyId}`);
      const phones = page.locator("[data-phones]");
      await expect(phones).toHaveText("PHONES WATCH FROM THE BACK OF THE ROOM");
      await expect(phones).toBeVisible();
      await expect(page.locator("[data-hud]")).toBeHidden();
      await expect(page.getByRole("heading")).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
    // hydrated, and still no socket: give a would-be mint and connect the time they take
    await page.waitForLoadState("networkidle");
    expect(sockets.filter((u) => u.includes("/socket.io/"))).toEqual([]);
    await page.setViewportSize({ width: 481, height: 812 });
    await expect(page.locator("[data-hud]")).toBeVisible();
    await expect(page.locator("[data-phones]")).toBeHidden();
  });
});
