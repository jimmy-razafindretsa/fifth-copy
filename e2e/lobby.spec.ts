import type { Browser, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// Contract of #107: the waiting room /lobby/[code] (bible 4, 7.3, 7.4, 7.10, 8), live over the race
// server started by playwright.config.ts. next/font and CSS modules rename families and keyframes,
// so both are matched by regex; colour roles are resolved to rgb through a probe element.

const LOBBY_PATH = /^\/lobby\/([A-HJ-NP-Z]{3}-[0-9]{4})$/;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

/** Computed rgb of a colour role, e.g. `role(page, "--color-fg")`. */
async function role(page: Page, variable: string): Promise<string> {
  const value = await page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${v})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
  expect(value, variable).not.toMatch(/^rgba\(0, 0, 0, 0\)$/);
  return value;
}

const roomCode = (page: Page) => page.getByRole("group", { name: "Room code" });
const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const rows = (page: Page) => roll(page).getByRole("listitem");
const liveRegion = (page: Page) => page.locator('main [aria-live="polite"]');
const typists = (page: Page) => page.locator("dt", { hasText: "TYPISTS" }).locator("+ dd");
const isLobbyAction = (method: string, url: string, headers: Record<string, string>) =>
  method === "POST" && new URL(url).pathname.startsWith("/lobby/") && !!headers["next-action"];

/** Creates a private race from the landing and returns its code. */
async function createLobby(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "CREATE PRIVATE RACE", exact: true }).click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname));
  return LOBBY_PATH.exec(new URL(page.url()).pathname)![1]!;
}

/** A different guest (fresh context) joins with the code from the landing. */
async function joinAsGuest(browser: Browser, code: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/");
  const form = page.getByRole("form", { name: "Join with code" });
  await form.getByLabel("JOIN WITH CODE", { exact: true }).pressSequentially(code);
  await form.getByRole("button", { name: "JOIN →", exact: true }).click();
  await page.waitForURL(`**/lobby/${code}`);
  return { context, page };
}

test.describe("lobby waiting room (#107)", () => {
  test("C1 C2 two guests see each other join and leave live", async ({ page, browser }) => {
    const code = await createLobby(page);
    await expect(roomCode(page)).toContainText(code);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("HOST");
    await expect(rows(page).first()).toContainText("YOU");
    await expect(liveRegion(page)).toHaveText("1 player in the room");
    await expect(typists(page)).toHaveText("1 / 30");

    const b = await joinAsGuest(browser, code);
    expect(new URL(b.page.url()).pathname).toBe(`/lobby/${code}`);
    await expect(rows(b.page)).toHaveCount(2);
    const bYou = rows(b.page).filter({ hasText: "YOU" });
    await expect(bYou).toHaveCount(1);
    await expect(bYou).not.toContainText("HOST");
    await expect(rows(b.page).filter({ hasText: "HOST" })).not.toContainText("YOU");

    // A updates without a reload
    await expect(rows(page)).toHaveCount(2, { timeout: 5_000 });
    await expect(liveRegion(page)).toHaveText("2 players in the room");
    await expect(typists(page)).toHaveText("2 / 30");

    await b.context.close();
    await expect(rows(page)).toHaveCount(1, { timeout: 5_000 });
    await expect(liveRegion(page)).toHaveText("1 player in the room");
    await expect(typists(page)).toHaveText("1 / 30");
    await expect(rows(page).first()).toContainText("YOU");
  });

  test("C3 an unknown code is a 404 and the landing says so", async ({ page, request }) => {
    expect((await request.get("/lobby/ZZZ-0000")).status()).toBe(404);
    expect((await request.get("/lobby/not-a-code")).status()).toBe(404);
    await page.goto("/");
    const form = page.getByRole("form", { name: "Join with code" });
    await form.getByLabel("JOIN WITH CODE", { exact: true }).pressSequentially("ZZZ0000");
    await form.getByRole("button", { name: "JOIN →", exact: true }).click();
    await expect(
      form.getByRole("alert").filter({ hasText: "No race with that code" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("C4 the race token stays out of the URL, the HTML and cookies", async ({ page }) => {
    const sent: string[] = [];
    page.on("websocket", (ws) => ws.on("framesent", (f) => sent.push(String(f.payload))));
    // dev StrictMode mounts the leaf twice, so collect every minted token (the first is discarded).
    // The mint POST is read through the route, not `response.text()`: Chromium may cancel it in
    // the renderer after the body arrived (fixtures.ts), and then the body is gone.
    const tokens: string[] = [];
    await page.route("**/lobby/**", async (route) => {
      const r = route.request();
      if (!isLobbyAction(r.method(), r.url(), r.headers())) return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      tokens.push(...(JWT.exec(body) ?? []));
      await route.fulfill({ response, body });
    });
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    expect(tokens.length, "the action response carries the token").toBeGreaterThan(0);

    expect(
      sent.some((frame) => tokens.some((t) => frame.includes(t))),
      "token in the handshake",
    ).toBe(true);
    const html = await page.content();
    expect(html).not.toMatch(JWT);
    const cookies = await page.context().cookies();
    for (const token of tokens) {
      expect(page.url()).not.toContain(token);
      expect(html).not.toContain(token);
      for (const cookie of cookies) expect(cookie.value, cookie.name).not.toContain(token);
    }
  });

  test("C6 loading skeleton is aria-busy and has no gradient", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/lobby/**", async (route) => {
      const r = route.request();
      if (isLobbyAction(r.method(), r.url(), r.headers())) await gate;
      await route.continue();
    });
    await createLobby(page);
    const busy = page.locator('ul[aria-busy="true"]');
    await expect(busy).toBeVisible();
    expect(await busy.locator("li").count()).toBeGreaterThan(0);
    const backgrounds = await busy
      .locator("li *")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundImage));
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const bg of backgrounds) expect(bg).not.toContain("linear-gradient");
    await expect(typists(page)).toHaveText("— / 30");
    release();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator("ul[aria-busy]")).toHaveCount(0);
  });

  test("C6 thirty rows scroll inside the list, the page never scrolls sideways", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "mobile", "the 375 px check");
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    // 30 sockets are not needed to test the CSS: clone the live row (markup of 30 is in vitest)
    const box = await roll(page).evaluate((ul) => {
      const li = ul.querySelector("li")!;
      for (let i = 2; i <= 30; i++) ul.append(li.cloneNode(true));
      return { scroll: ul.scrollHeight, client: ul.clientHeight, count: ul.children.length };
    });
    expect(box.count).toBe(30);
    expect(box.scroll).toBeGreaterThan(box.client);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("C6 a dropped connection shows the pulsing reconnecting row", async ({ page }) => {
    const sockets: { close(): Promise<void> }[] = [];
    // the first socket reaches the server; later attempts hang, so the page stays reconnecting
    await page.routeWebSocket(/\/socket\.io\//, (ws) => {
      if (sockets.length === 0) ws.connectToServer();
      sockets.push(ws);
    });
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    await sockets[0]!.close();
    const notice = page.getByRole("status").filter({ hasText: "CONNECTION LOST, RETRYING" });
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(rows(page)).toHaveCount(1);
    const animation = await notice.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toMatch(/lkPulse$/);
  });

  test("C7 bible components through tokens", async ({ page }) => {
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    const fg = await role(page, "--color-fg");
    const bg = await role(page, "--color-bg");
    const surface = await role(page, "--color-surface");
    const primary = await role(page, "--color-primary");

    const docket = await roomCode(page).evaluate((el) => {
      const s = getComputedStyle(el.parentElement!);
      return {
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        bg: s.backgroundColor,
        radius: s.borderRadius,
      };
    });
    expect(docket).toEqual({ border: `2px solid ${fg}`, bg: surface, radius: "0px" });

    const code = await roomCode(page)
      .locator("span")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, spacing: s.letterSpacing };
      });
    expect(code.family).toMatch(/IBM.?Plex.?Mono/i);
    expect(code.spacing).toBe("1.44px");

    const heading = await page.getByRole("heading", { level: 1 }).evaluate((el) => {
      const s = getComputedStyle(el);
      return { family: s.fontFamily, transform: s.textTransform };
    });
    expect(heading.family).toMatch(/Stardos.?Stencil/i);
    expect(heading.transform).toBe("uppercase");

    const stamp = rows(page).first().locator("[data-stamp-tone]");
    await expect(stamp).toBeVisible();
    const s = await stamp.evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`,
        name: c.animationName,
        duration: parseFloat(c.animationDuration),
      };
    });
    expect(s.border).toBe(`4px double ${primary}`);
    expect(s.name).toMatch(/fcSlam$/);
    expect(s.duration).toBeGreaterThanOrEqual(0.3);
    expect(s.duration).toBeLessThanOrEqual(0.45);
    // the slam settles on the fixed −6° (fill mode both)
    await expect
      .poll(() => stamp.evaluate((el) => getComputedStyle(el).transform))
      .toMatch(/^matrix\(0\.99\d*, -0\.10\d*, 0\.10\d*, 0\.99\d*, 0, 0\)$/);

    const you = await rows(page)
      .first()
      .getByText("YOU", { exact: true })
      .evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, color: c.color };
      });
    expect(you).toEqual({ bg: fg, color: bg });

    const separator = await page
      .locator("dl > div")
      .nth(1)
      .evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(separator).toBe("dashed");
  });

  test("C7 the stamp does not slam under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await createLobby(page);
    const stamp = rows(page).first().locator("[data-stamp-tone]");
    await expect(stamp).toBeVisible();
    const s = await stamp.evaluate((el) => {
      const c = getComputedStyle(el);
      return { name: c.animationName, duration: c.animationDuration, transform: c.transform };
    });
    expect(s.name === "none" || s.duration === "0.01ms", JSON.stringify(s)).toBe(true);
    expect(s.transform).not.toBe("none");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C8 ${scheme}: accessible, real list rows, no horizontal scroll`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await createLobby(page);
      await expect(rows(page)).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // badges are text, not colour only
      await expect(rows(page).first().getByText("HOST", { exact: true })).toBeVisible();
      await expect(rows(page).first().getByText("YOU", { exact: true })).toBeVisible();
      expect(await roll(page).evaluate((el) => el.tagName)).toBe("UL");
      expect(
        await rows(page)
          .first()
          .evaluate((el) => el.tagName),
      ).toBe("LI");
      await expectNoA11yViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
