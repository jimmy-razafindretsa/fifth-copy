import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";
import {
  createLobby,
  hostRoom,
  joinAsGuest,
  lobbyStatusOf,
  phaseOf,
  recordRaceTokens,
  setHostSettings,
  startButton,
  warmRace,
} from "./race/helpers";
import { Client } from "pg";
import { contrastRatio, type Rgb } from "../src/lib/color";
import { becomeGuest, guestIdOf, SEEDED_VERSION, seedAvatar } from "./identity/avatar-helpers";
import { ACTION_WAIT, HYDRATION_WAIT, scaled } from "./timeouts";

// Contract of #107: the waiting room /lobby/[code] (bible 4, 7.3, 7.4, 7.10, 8), live over the race
// server started by playwright.config.ts. next/font and CSS modules rename families and keyframes,
// so both are matched by regex; colour roles are resolved to rgb through a probe element.

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
    await expect(rows(page)).toHaveCount(2, { timeout: scaled(5_000) });
    await expect(liveRegion(page)).toHaveText("2 players in the room");
    await expect(typists(page)).toHaveText("2 / 30");

    await b.context.close();
    await expect(rows(page)).toHaveCount(1, { timeout: scaled(5_000) });
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

  test("#734 C5 the host closes the tab: the lobby row reads CLOSED within 10 s, a join gets the closed line", async ({
    browser,
  }) => {
    const host = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const page = await host.newPage();
    const code = await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    expect(await lobbyStatusOf(code)).toBe("WAITING");

    // Last human leaves: the race server closes the room and tells the web through its outbox.
    await host.close();
    await expect.poll(() => lobbyStatusOf(code), { timeout: scaled(10_000) }).toBe("CLOSED");

    const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const other = await visitor.newPage();
      await other.goto("/");
      const form = other.getByRole("form", { name: "Join with code" });
      await form.getByLabel("JOIN WITH CODE", { exact: true }).pressSequentially(code);
      await form.getByRole("button", { name: "JOIN →", exact: true }).click();
      await expect(
        form.getByRole("alert").filter({ hasText: "That race has already started or closed" }),
      ).toBeVisible();
      await expect(other).toHaveURL(/\/$/);
    } finally {
      await visitor.close();
    }
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
    await expect(notice).toBeVisible({ timeout: scaled(10_000) });
    await expect(rows(page)).toHaveCount(1);
    const animation = await notice.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toMatch(/lkPulse$/);

    // #639 C2: still lkPulse 1.3s; held at its dip (50%), the text keeps 4.5:1 in light and Night shift
    expect(await notice.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("1.3s");
    await notice.evaluate((el) => {
      for (const a of el.getAnimations()) {
        a.pause();
        a.currentTime = 650;
      }
    });
    expect(await notice.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.75");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const { violations } = await new AxeBuilder({ page })
        .withRules(["color-contrast"])
        .exclude("iframe")
        .analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `${scheme}: color-contrast at the dip`,
      ).toEqual([]);
    }

    // under reduced motion it holds still
    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await notice.evaluate((el) => {
      const c = getComputedStyle(el);
      return { name: c.animationName, opacity: c.opacity };
    });
    expect(still).toEqual({ name: "none", opacity: "1" });
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

// Contract of #105: the roll says who is a bot (the ink BOT tag), a non-host waits on the 7.4 notice row
// WAITING FOR THE HOST where the host has START, and the kicker names the lobby's type (bible 14.3).
const waitingNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "WAITING FOR THE HOST" });
const kicker = (page: Page) =>
  page.locator('section[aria-labelledby="lobby-heading"] > div').first();
const botRows = (page: Page) => rows(page).filter({ has: page.getByText("BOT", { exact: true }) });

test.describe("lobby roll: BOT tag, non-host notice, kicker (#105)", () => {
  test("C2 the host sees START and no notice, a guest the still notice row and no START", async ({
    page,
    browser,
  }) => {
    const code = await createLobby(page);
    const b = await joinAsGuest(browser, code);
    await expect(rows(b.page)).toHaveCount(2);
    await expect(waitingNotice(b.page)).toHaveCount(1);
    await expect(waitingNotice(b.page)).toBeVisible();
    await expect(startButton(b.page)).toHaveCount(0);

    await expect(rows(page)).toHaveCount(2, { timeout: scaled(5_000) });
    await expect(startButton(page)).toBeVisible();
    await expect(waitingNotice(page)).toHaveCount(0);

    // a 7.4 notice row: Oswald 600 11px .16em, dashed rule under it, at the top of the roll, no pulse
    const style = await waitingNotice(b.page).evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        family: c.fontFamily,
        weight: c.fontWeight,
        size: c.fontSize,
        spacing: c.letterSpacing,
        rule: c.borderBottomStyle,
        animation: c.animationName,
        first: el.parentElement!.firstElementChild === el,
      };
    });
    expect(style.family).toMatch(/Oswald/i);
    expect(style).toMatchObject({
      weight: "600",
      size: "11px",
      spacing: "1.76px",
      rule: "dashed",
      animation: "none",
      first: true,
    });
    await b.context.close();
  });

  test("C3 the kicker names the room: private from CREATE PRIVATE RACE, public from QUICK RACE @matchmaking", async ({
    page,
  }) => {
    await createLobby(page);
    await expect(kicker(page)).toHaveText("WAITING ROOM · PRIVATE RACE");

    await page.goto("/");
    // the QUICK RACE form is a client action: wait for the landing to hydrate (landing.spec.ts `ready`)
    await expect(page.locator("section#play video[aria-hidden='true']")).toHaveAttribute(
      "data-feed",
      /^(armed|near)$/,
      { timeout: HYDRATION_WAIT },
    );
    await page.locator("section#play").getByRole("button", { name: "QUICK RACE" }).click();
    await page.waitForURL(/\/lobby\/[A-Z]{3}-\d{4}$/);
    await expect(kicker(page)).toHaveText("WAITING ROOM · PUBLIC RACE");
  });

  test("C4 a seated bot shows its row with the ink BOT tag in every context; removing it removes the row", async ({
    page,
    browser,
  }) => {
    await recordRaceTokens(page);
    const code = await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    const hostName = await rows(page).first().locator("[data-name]").textContent();

    await setHostSettings(page, { bots: [{ level: "clerk" }] });
    await expect(rows(page)).toHaveCount(2, { timeout: scaled(2_000) });
    await expect(typists(page)).toHaveText("2 / 30");
    const bot = botRows(page);
    await expect(bot).toHaveCount(1);
    await expect(bot).not.toContainText("YOU");
    await expect(bot.locator("[data-stamp-tone]")).toHaveCount(0);
    const botName = (await bot.locator("[data-name]").textContent())?.trim() ?? "";
    expect(botName).not.toBe("");
    expect(botName).not.toBe(hostName?.trim());
    // the YOU tag's recipe: Oswald 600 10px .16em on ink, paper text
    const tag = await bot.getByText("BOT", { exact: true }).evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        family: c.fontFamily,
        weight: c.fontWeight,
        size: c.fontSize,
        spacing: c.letterSpacing,
        bg: c.backgroundColor,
        color: c.color,
      };
    });
    expect(tag.family).toMatch(/Oswald/i);
    expect(tag).toMatchObject({ weight: "600", size: "10px", spacing: "1.6px" });
    expect({ bg: tag.bg, color: tag.color }).toEqual({
      bg: await role(page, "--color-fg"),
      color: await role(page, "--color-bg"),
    });
    // humans carry no BOT tag
    await expect(rows(page).first()).not.toContainText("BOT");

    // a second context sees the same bot row
    const b = await joinAsGuest(browser, code);
    await expect(rows(b.page)).toHaveCount(3);
    await expect(botRows(b.page)).toHaveCount(1);
    await expect(botRows(b.page)).toContainText(botName);
    await expect(rows(page)).toHaveCount(3, { timeout: scaled(2_000) });

    await setHostSettings(page, { bots: [] });
    await expect(botRows(page)).toHaveCount(0, { timeout: scaled(2_000) });
    await expect(botRows(b.page)).toHaveCount(0, { timeout: scaled(2_000) });
    await expect(rows(page)).toHaveCount(2);
    await expect(typists(page)).toHaveText("2 / 30");
    await b.context.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C5 ${scheme}: axe clean with a bot row (host view) and the notice (guest view)`, async ({
      page,
      browser,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await recordRaceTokens(page);
      const code = await createLobby(page);
      await setHostSettings(page, { bots: [{ level: "clerk" }] });
      await expect(botRows(page)).toHaveCount(1, { timeout: scaled(2_000) });
      await expectNoA11yViolations(page);

      const b = await joinAsGuest(browser, code);
      await b.page.emulateMedia({ colorScheme: scheme });
      await expect(waitingNotice(b.page)).toBeVisible();
      await expect(botRows(b.page)).toHaveCount(1);
      await expectNoA11yViolations(b.page);
      await b.context.close();
    });
  }
});

// Contract of #498: the lobby layout (bible 14.3, 7.4, 7.1, 7.10): the read-only FORM 5-L settings
// docket following the host's broadcast, the invite row's COPY, START under the settings docket.
const settingsDocket = (page: Page) => page.getByRole("region", { name: "RACE SETTINGS" });
const setting = (page: Page, label: string) =>
  settingsDocket(page)
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("+ dd");
/** A segment of the host's #110 segmented toggle in a settings row, named by the row's label. */
const segment = (page: Page, row: string, name: string) =>
  settingsDocket(page)
    .getByRole("group", { name: row, exact: true })
    .getByRole("button", { name, exact: true });
const copyButton = (page: Page) => page.getByRole("button", { name: /^COP(Y|IED)$/ });
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("lobby layout: settings docket, invite COPY, START (#498)", () => {
  test("C3 a second context's docket follows the host's settings broadcast", async ({
    page,
    browser,
  }) => {
    test.skip(test.info().project.name === "mobile", "phones hide the settings docket (C5)");
    await recordRaceTokens(page);
    const code = await createLobby(page);
    const b = await joinAsGuest(browser, code);
    await expect(setting(b.page, "ERROR MODE")).toHaveText("CONTINUE");
    await expect(setting(b.page, "TIMER")).toHaveText("NO TIMER");
    await expect(setting(b.page, "BACKSPACE")).toHaveText("ON");
    await expect(setting(b.page, "WORDS")).toHaveText("50 WORDS");

    await setHostSettings(page, { errorMode: "block", timerS: 300 });
    await expect(setting(b.page, "ERROR MODE")).toHaveText("BLOCK", { timeout: scaled(2_000) });
    await expect(setting(b.page, "TIMER")).toHaveText("5 MIN", { timeout: scaled(2_000) });
    await expect(settingsDocket(b.page).locator("dt", { hasText: "BACKSPACE" })).toHaveCount(0);
    // the host's own docket follows too (its row holds the #110 control: the pressed segment)
    await expect(segment(page, "ERROR MODE", "BLOCK")).toHaveAttribute("aria-pressed", "true", {
      timeout: scaled(2_000),
    });
    await b.context.close();
  });

  test("C4 COPY writes the room code to the clipboard and reads COPIED, then COPY", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "phones hide the invite row (C5)");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const code = await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    const button = copyButton(page);
    await expect(button).toHaveText("COPY");
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const ink = await button.evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        family: c.fontFamily,
        weight: c.fontWeight,
        size: c.fontSize,
        bg: c.backgroundColor,
      };
    });
    expect(ink.family).toMatch(/Oswald/i);
    expect(ink).toMatchObject({ weight: "600", size: "13px", bg: await role(page, "--color-fg") });

    await button.click();
    await expect(button).toHaveText("COPIED");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    // --motion-duration-slow x 3 (1.8 s), then back
    await expect(button).toHaveText("COPY", { timeout: scaled(5_000) });
  });

  test("C4 without a clipboard API, COPY selects the room code", async ({ page }) => {
    test.skip(test.info().project.name === "mobile", "phones hide the invite row (C5)");
    await page.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined }),
    );
    const code = await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    await copyButton(page).click();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(code);
    await expect(copyButton(page)).toHaveText("COPY");
  });

  test("C4 under reduced motion COPIED stays until the button blurs", async ({ page }) => {
    test.skip(test.info().project.name === "mobile", "phones hide the invite row (C5)");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    const button = copyButton(page);
    await button.click();
    await expect(button).toHaveText("COPIED");
    // past the 1.8 s hold of full motion: the 0 ms token never flashes it back
    await page.waitForTimeout(2_200);
    await expect(button).toHaveText("COPIED");
    await button.blur();
    await expect(button).toHaveText("COPY");
  });

  test("C5 C6 the layout per width; START under the settings docket, unchanged", async ({
    page,
  }) => {
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    const start = startButton(page);
    await expect(start).toBeDisabled();
    await expect(page.getByText("TWO TYPISTS NEEDED", { exact: true })).toBeVisible();
    await expect(roomCode(page)).toBeVisible();
    const rollBox = (await roll(page).boundingBox())!;
    const startBox = (await start.boundingBox())!;

    if (test.info().project.name === "mobile") {
      // phones watch (bible 18): the room docket, the roll and START only, START last
      await expect(settingsDocket(page)).toBeHidden();
      await expect(copyButton(page)).toBeHidden();
      expect(startBox.y).toBeGreaterThan(rollBox.y + rollBox.height);
    } else {
      // the dockets column, START under the settings docket; then the side (seat ring #731, the roll
      // under it): beside the column from 1024, wrapped under it below (bible 14.3: the ring needs 500px)
      await expect(settingsDocket(page)).toBeVisible();
      await expect(copyButton(page)).toBeVisible();
      const settingsBox = (await settingsDocket(page).boundingBox())!;
      const docketBox = (await roomCode(page).locator("..").boundingBox())!;
      const ringBox = (await page.locator("[data-seat-ring]").boundingBox())!;
      expect(rollBox.y).toBeGreaterThanOrEqual(ringBox.y + ringBox.height);
      if (test.info().project.name === "desktop") {
        expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(rollBox.x);
        // the column's first docket and the side (its ring) start on the same line
        expect(Math.abs(docketBox.y - ringBox.y)).toBeLessThanOrEqual(2);
      } else {
        expect(ringBox.y).toBeGreaterThanOrEqual(startBox.y + startBox.height);
      }
      expect(settingsBox.y).toBeGreaterThanOrEqual(docketBox.y + docketBox.height);
      expect(startBox.y).toBeGreaterThanOrEqual(settingsBox.y + settingsBox.height);
      expect(Math.abs(startBox.x - settingsBox.x)).toBeLessThanOrEqual(2);
    }
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  });
});

// Contract of #110: the host's settings form in the FORM 5-L rows (bible 14.3 "Host settings form",
// 7.1 segmented toggle, 7.2 inputs, 7.4 inline error line), over the real `host:settings` path. Each test
// stays under the 30 per 10 s `host:settings` budget of the host's token (#750).
test.describe("host settings form (#110)", () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) <= 480,
    "phones hide the settings docket (#498)",
  );

  test("C5 the host's BLOCK and 3 MIN reach the guest within 2 s; FRENCH leaves the UI in English", async ({
    page,
    browser,
  }) => {
    const code = await createLobby(page);
    const b = await joinAsGuest(browser, code);
    await expect(rows(page)).toHaveCount(2);

    await segment(page, "ERROR MODE", "BLOCK").click();
    await expect(segment(page, "ERROR MODE", "BLOCK")).toHaveAttribute("aria-pressed", "true");
    await expect(setting(b.page, "ERROR MODE")).toHaveText("BLOCK", { timeout: scaled(2_000) });
    // block mode: no backspace row on either side
    await expect(settingsDocket(page).locator('[data-setting="backspace"]')).toHaveCount(0);
    await expect(settingsDocket(b.page).locator("dt", { hasText: "BACKSPACE" })).toHaveCount(0);

    // releasing NO TIMER starts at the schema minimum; the minutes commit on Enter
    const noTimer = settingsDocket(page).getByRole("button", { name: "NO TIMER", exact: true });
    await noTimer.click();
    await expect(noTimer).toHaveAttribute("aria-pressed", "false");
    await expect(setting(b.page, "TIMER")).toHaveText("1 MIN", { timeout: scaled(2_000) });
    const minutes = settingsDocket(page).getByRole("spinbutton", { name: /^TIMER/ });
    await minutes.fill("3");
    await minutes.press("Enter");
    await expect(setting(b.page, "TIMER")).toHaveText("3 MIN", { timeout: scaled(2_000) });
    await expect(minutes).toHaveValue("3");

    // the guest has no control at all
    await expect(settingsDocket(b.page).getByRole("button")).toHaveCount(0);
    await expect(settingsDocket(b.page).getByRole("spinbutton")).toHaveCount(0);
    await expect(settingsDocket(b.page).getByRole("textbox")).toHaveCount(0);

    // the race language is a setting, never the UI language (R190, ADR 0010)
    await segment(page, "LANGUAGE", "FRENCH").click();
    await expect(setting(b.page, "LANGUAGE")).toHaveText("FRENCH", { timeout: scaled(2_000) });
    await expect(segment(page, "ACCENTS", "OFF")).toHaveAttribute("aria-pressed", "true");
    for (const p of [page, b.page]) {
      await expect(p.locator("html")).toHaveAttribute("lang", "en");
      await expect(p.getByRole("heading", { level: 1 })).toHaveText("REPORT TO YOUR DESK");
      await expect(settingsDocket(p).locator("dt").first()).toHaveText("LANGUAGE");
      await expect(settingsDocket(p).getByText("ACCENTS", { exact: true })).toBeVisible();
    }
    await b.context.close();
  });

  test("C4 an invalid value never leaves the page: the inline line, the broadcast value back", async ({
    page,
    browser,
  }) => {
    const code = await createLobby(page);
    const b = await joinAsGuest(browser, code);
    const words = settingsDocket(page).getByRole("spinbutton", { name: "WORDS", exact: true });
    await expect(words).toHaveValue("50");
    await words.fill("9000");
    await words.press("Enter");
    const line = page.getByRole("alert").filter({ hasText: "RETURNED ·" });
    await expect(line).toHaveText("RETURNED · Words take a whole number from 10 to 500.");
    await expect(line).not.toContainText("9000");
    await expect(words).toHaveValue("50");
    await expect(words).toHaveAttribute("aria-describedby", "lobby-settings-error");

    const letters = settingsDocket(page).getByRole("textbox", { name: "PRACTICE LETTERS" });
    await letters.fill("a1");
    await letters.press("Enter");
    await expect(line).toHaveText("RETURNED · Practice letters take letters only, each one once.");
    await expect(letters).toHaveValue("");
    // nothing reached the room
    await expect(setting(b.page, "WORDS")).toHaveText("50 WORDS");
    await expect(setting(b.page, "PRACTICE LETTERS")).toHaveText("NONE");

    // a valid value then goes through and clears the line
    await letters.fill("é è");
    await letters.press("Enter");
    await expect(setting(b.page, "PRACTICE LETTERS")).toHaveText("é è", {
      timeout: scaled(2_000),
    });
    await expect(line).toHaveCount(0);
    await b.context.close();
  });

  test("C6 every control is keyboard-reachable and labelled; 44px tall on touch widths", async ({
    page,
  }) => {
    await createLobby(page);
    const docket = settingsDocket(page);
    await expect(segment(page, "ERROR MODE", "CONTINUE")).toBeVisible();
    // custom difficulty opens its recipe rows, each with its own control
    const custom = segment(page, "DIFFICULTY", "CUSTOM");
    await custom.focus();
    await page.keyboard.press("Enter");
    await expect(segment(page, "WORD LENGTH", "MEDIUM")).toHaveAttribute("aria-pressed", "true");
    await expect(segment(page, "PUNCTUATION DENSITY", "LIGHT")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(segment(page, "RARE LETTERS", "OFF")).toHaveAttribute("aria-pressed", "true");
    // the focus stays on the control while the change is on its way (aria-disabled, not disabled)
    await expect(custom).toBeFocused();

    const controls = docket.locator("button, input");
    const n = await controls.count();
    expect(n).toBeGreaterThan(25);
    const touch = test.info().project.name === "tablet";
    for (let i = 0; i < n; i++) {
      const control = controls.nth(i);
      const name = await control.evaluate(
        (el) =>
          (el as HTMLElement).closest("[role=group]")?.getAttribute("aria-labelledby") ??
          el.getAttribute("aria-labelledby") ??
          el.textContent,
      );
      expect(name, `control ${i} named`).toBeTruthy();
      if (await control.isDisabled()) continue; // the minutes under NO TIMER
      expect(await control.getAttribute("tabindex")).not.toBe("-1");
      if (touch) {
        const box = (await control.boundingBox())!;
        expect(box.height, `control ${i} height`).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C6 ${scheme}: axe clean for the host's form (a refusal shown) and the guest's rows`, async ({
      page,
      browser,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const code = await createLobby(page);
      await segment(page, "DIFFICULTY", "CUSTOM").click();
      await expect(segment(page, "WORD LENGTH", "MEDIUM")).toBeVisible();
      const words = settingsDocket(page).getByRole("spinbutton", { name: "WORDS", exact: true });
      await words.fill("5");
      await words.press("Enter");
      await expect(page.getByRole("alert").filter({ hasText: "RETURNED ·" })).toBeVisible();
      await expectNoA11yViolations(page);

      const b = await joinAsGuest(browser, code);
      await b.page.emulateMedia({ colorScheme: scheme });
      await expect(setting(b.page, "DIFFICULTY")).toContainText("CUSTOM");
      await expectNoA11yViolations(b.page);
      await b.context.close();
    });
  }
});

// Contract of #114: the host's bot rows (one per bot: level, WPM, REMOVE; ADD A BOT) over #110's
// `host:settings` path, and the LOBBY row's PUBLIC / PRIVATE toggle bound to the web action
// `setLobbyType` (Postgres owns `Lobby.type`, ADR 0008). The C2 path stays at 4 patches in 10 s (#750).
const addBot = (page: Page) =>
  settingsDocket(page).getByRole("button", { name: "ADD A BOT", exact: true });
const botSubRows = (page: Page) => settingsDocket(page).locator('[data-setting^="bots."]');

test.describe("bot rows and lobby type (#114)", () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) <= 480,
    "phones hide the settings docket (#498)",
  );

  test("C2 the host adds Clerk and Major; both rolls show two BOT rows within 2 s; REMOVE drops one", async ({
    page,
    browser,
  }) => {
    const code = await createLobby(page);
    const b = await joinAsGuest(browser, code);
    await expect(rows(page)).toHaveCount(2, { timeout: scaled(5_000) });
    await expect(setting(b.page, "BOTS")).toHaveText("NONE");

    // a new bot files at Clerk: the first needs no level change
    await addBot(page).click();
    await expect(botSubRows(page)).toHaveCount(1, { timeout: scaled(2_000) });
    await expect(segment(page, "BOT 1", "CLERK")).toHaveAttribute("aria-pressed", "true");
    await expect(botSubRows(page).first()).toContainText("35 WPM");
    await addBot(page).click();
    await expect(botSubRows(page)).toHaveCount(2, { timeout: scaled(2_000) });
    await segment(page, "BOT 2", "MAJOR").click();
    await expect(segment(page, "BOT 2", "MAJOR")).toHaveAttribute("aria-pressed", "true", {
      timeout: scaled(2_000),
    });
    await expect(botSubRows(page).nth(1)).toContainText("90 WPM");

    for (const p of [page, b.page])
      await expect(botRows(p)).toHaveCount(2, { timeout: scaled(2_000) });
    await expect(setting(b.page, "BOTS")).toHaveText("2 BOTS · CLERK, MAJOR", {
      timeout: scaled(2_000),
    });
    // the guest never gets a control
    await expect(settingsDocket(b.page).getByRole("button")).toHaveCount(0);

    await settingsDocket(page).getByRole("button", { name: "REMOVE BOT 1", exact: true }).click();
    for (const p of [page, b.page])
      await expect(botRows(p)).toHaveCount(1, { timeout: scaled(2_000) });
    await expect(botSubRows(page)).toHaveCount(1);
    await expect(setting(b.page, "BOTS")).toHaveText("1 BOT · MAJOR");
    await b.context.close();
  });

  // a PUBLIC room is joinable by any QUICK RACE (#128): `matchmaking` project
  test("C3 C4 the host files PUBLIC: the kicker follows; the guest reads PUBLIC after a reload @matchmaking", async ({
    page,
    browser,
  }) => {
    const code = await createLobby(page);
    const b = await joinAsGuest(browser, code);
    await expect(kicker(page)).toHaveText("WAITING ROOM · PRIVATE RACE");
    await expect(segment(page, "LOBBY", "PRIVATE")).toHaveAttribute("aria-pressed", "true");
    await expect(setting(b.page, "LOBBY")).toHaveText("PRIVATE");

    await segment(page, "LOBBY", "PUBLIC").click();
    await expect(kicker(page)).toHaveText("WAITING ROOM · PUBLIC RACE", { timeout: scaled(5_000) });
    await expect(segment(page, "LOBBY", "PUBLIC")).toHaveAttribute("aria-pressed", "true");
    await expect(settingsDocket(page).locator('[data-setting="lobbyType"]')).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
    // the room stayed connected through the refresh: the roll still holds both typists
    await expect(rows(page)).toHaveCount(2);

    // no broadcast of the type (C4): the guest reads it from the row on the next load
    await b.page.reload();
    await expect(setting(b.page, "LOBBY")).toHaveText("PUBLIC", { timeout: scaled(5_000) });
    await expect(kicker(b.page)).toHaveText("WAITING ROOM · PUBLIC RACE");
    await expect(settingsDocket(b.page).getByRole("button")).toHaveCount(0);
    await b.context.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C5 ${scheme}: bot rows and the lobby toggle labelled, 44px on touch, axe clean`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await createLobby(page);
      await addBot(page).click();
      await expect(botSubRows(page)).toHaveCount(1, { timeout: scaled(2_000) });
      await expect(
        settingsDocket(page).getByRole("button", { name: "REMOVE BOT 1", exact: true }),
      ).toBeVisible();
      await expect(settingsDocket(page).getByRole("group", { name: "LOBBY" })).toBeVisible();
      const touch = test.info().project.name === "tablet";
      const controls = settingsDocket(page).locator(
        '[data-setting="bots"] button, [data-setting^="bots."] button, [data-setting="lobbyType"] button',
      );
      const n = await controls.count();
      expect(n).toBe(1 + 5 + 1 + 2);
      if (touch)
        for (let i = 0; i < n; i++)
          expect(
            (await controls.nth(i).boundingBox())!.height,
            `control ${i}`,
          ).toBeGreaterThanOrEqual(44);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await expectNoA11yViolations(page);
    });
  }
});

// Contract of #732 C3: a late joiner. Host and guest start a race (Block mode, 10 words, untimed); a third
// context opens /lobby/<code> during it and sees the 7.4 notice over the skeleton rows, no START; host and
// guest type the strip to the end; within 5 s the third roll shows three rows and the notice is gone
// (seated by the ended room, #732 race-server change); the host comes back through RACE AGAIN to three
// rows and an enabled START.
const raceInProgress = (page: Page) =>
  page.getByRole("status").filter({ hasText: "RACE IN PROGRESS · YOU ARE SEATED WHEN IT ENDS" });

test.describe("late joiner (#732 C3)", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
  });

  test("C3: held during the race, seated when it ends; the host's START is enabled", async ({
    page,
    browser,
  }) => {
    test.setTimeout(scaled(120_000));
    const RACE_PATH = /\/race\/([0-9a-f-]{36})$/;
    const input = (p: Page) => p.getByRole("textbox", { name: "Text to type" });
    const strip = async (p: Page) =>
      (await p.locator("[data-telex] [data-state]").allTextContents()).join("");

    const { host, code, lobbyId } = await hostRoom(browser, opened, { before: recordRaceTokens });
    await setHostSettings(host, { errorMode: "block", wordCount: 10, timerS: null });
    await page.goto(`/race/${lobbyId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^SEAT VIEW · DESK \d{2}$/);
    await expect(startButton(host)).toBeEnabled();
    await warmRace(host, lobbyId);
    await startButton(host).click();
    await expect(host).toHaveURL(RACE_PATH);
    const raceId = RACE_PATH.exec(host.url())![1]!;
    for (const p of [host, page]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(10_000),
      });
      await expect(input(p)).toHaveAttribute("data-mode", "block");
    }

    // the late joiner: the notice, the skeleton rows, no START
    const lateContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    opened.push(lateContext);
    const late = await lateContext.newPage();
    await late.goto(`/lobby/${code}`);
    await expect(raceInProgress(late)).toBeVisible({ timeout: scaled(10_000) });
    await expect(roll(late)).toHaveAttribute("aria-busy", "true");
    await expect(startButton(late)).toHaveCount(0);
    await expect(late.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);

    // host and guest finish: the race ends all-finished
    const texts = await Promise.all([host, page].map(strip));
    await Promise.all([host, page].map((p, i) => p.keyboard.type(texts[i]!, { delay: 40 })));
    for (const p of [host, page]) {
      await expect(p.locator('[data-seat-status] [data-finished="ended"]')).toBeVisible({
        timeout: scaled(20_000),
      });
    }
    // within 5 s of the end
    await expect(rows(late)).toHaveCount(3, { timeout: scaled(5_000) });
    await expect(raceInProgress(late)).toHaveCount(0);
    await expect(startButton(late)).toHaveCount(0);

    // the host comes back through the Dawn report's RACE AGAIN: three seated, START enabled
    await host.getByRole("link", { name: "DAWN REPORT →" }).click();
    await expect(host).toHaveURL(`/results/${raceId}`);
    // the report is filed (the filing notice refreshes the page): click only then, as race-again.spec
    await expect(host.locator("[data-ranking] tbody tr")).toHaveCount(2, {
      timeout: scaled(15_000),
    });
    await host.getByRole("link", { name: "RACE AGAIN", exact: true }).click();
    await expect(host).toHaveURL(`/lobby/${code}`);
    await expect(rows(host)).toHaveCount(3, { timeout: scaled(10_000) });
    await expect(startButton(host)).toBeEnabled();
    await expect(rows(late)).toHaveCount(3);
  });
});

// Contract of #731 C3-C5: the seat ring diagram follows the roster live (a guest joining, a bot seated
// through `host:settings`), fits its slot at 768 / 1024 / 1280, hides at 480 and under, and keeps its
// initials at 4.5:1 and its rival rules at 3:1 in both themes (computed colours, as e2e/race/race-card).
const seatRing = (page: Page) => page.getByRole("img", { name: /^Seat ring: / });
const ringCell = (page: Page, desk: number) =>
  page.locator(`[data-seat-ring] [data-desk="${desk}"]`);
const rgbOf = (css: string): Rgb => {
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(css);
  expect(m, css).not.toBeNull();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
};

test.describe("seat ring diagram (#731)", () => {
  test("C3 phones: no ring at 480px and under, the roll stays", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "the 375 px check");
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator("[data-seat-ring]")).toBeHidden();
    expect(
      await page.locator("[data-seat-ring]").evaluate((el) => getComputedStyle(el).display),
    ).toBe("none");
  });

  test("C3 C4 one named image that follows the roster within 2 s; never focusable; fits 768 / 1024 / 1280", async ({
    page,
    browser,
  }) => {
    test.skip(test.info().project.name !== "desktop", "drives its own viewports");
    await recordRaceTokens(page);
    const code = await createLobby(page);
    await expect(seatRing(page)).toHaveAccessibleName("Seat ring: 1 of 30 desks taken");
    await expect(ringCell(page, 1)).toHaveAttribute("data-state", "you");
    await expect(page.locator("[data-seat-ring] [aria-hidden='true'][data-desk]")).toHaveCount(30);
    expect(await seatRing(page).evaluate((el) => (el as HTMLElement).tabIndex)).toBe(-1);

    const b = await joinAsGuest(browser, code);
    await expect(seatRing(page)).toHaveAccessibleName("Seat ring: 2 of 30 desks taken", {
      timeout: scaled(2_000),
    });
    await expect(ringCell(b.page, 2)).toHaveAttribute("data-state", "you");
    await expect(ringCell(b.page, 1)).toHaveAttribute("data-state", "taken");

    await setHostSettings(page, { bots: [{ level: "clerk" }] });
    for (const p of [page, b.page])
      await expect(seatRing(p)).toHaveAccessibleName("Seat ring: 3 of 30 desks taken", {
        timeout: scaled(2_000),
      });
    const bot = page.locator("[data-seat-ring] [data-bot='true']");
    await expect(bot).toHaveCount(1);
    await expect(bot).toContainText("B");

    for (const width of [768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(seatRing(page)).toBeVisible();
      const fit = await page.evaluate(() => {
        const ring = document.querySelector("[data-seat-ring]")!;
        const slot = ring.parentElement!.getBoundingClientRect();
        const cells = [...ring.querySelectorAll("[data-desk]")].map((c) =>
          c.getBoundingClientRect(),
        );
        return {
          page: document.documentElement.scrollWidth - window.innerWidth,
          left: Math.min(...cells.map((c) => c.left)) - slot.left,
          right: slot.right - Math.max(...cells.map((c) => c.right)),
          // desks never overlap (each placed on its own spot of the circle)
          overlaps: cells.some((a, i) =>
            cells.some(
              (c, j) =>
                j > i &&
                a.left < c.right - 0.5 &&
                c.left < a.right - 0.5 &&
                a.top < c.bottom - 0.5 &&
                c.top < a.bottom - 0.5,
            ),
          ),
        };
      });
      expect(fit.page, `${width}: no horizontal scroll`).toBeLessThanOrEqual(0);
      expect(fit.left, `${width}: inside its slot`).toBeGreaterThanOrEqual(0);
      expect(fit.right, `${width}: inside its slot`).toBeGreaterThanOrEqual(0);
      expect(fit.overlaps, `${width}: desks apart`).toBe(false);
    }
    await b.context.close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C5 ${scheme}: initials 4.5:1 on paper and on you, rival rules 3:1; axe clean`, async ({
      page,
      browser,
    }) => {
      test.skip(test.info().project.name !== "desktop", "one width is enough for colours");
      await page.emulateMedia({ colorScheme: scheme });
      await recordRaceTokens(page);
      const code = await createLobby(page);
      const b = await joinAsGuest(browser, code);
      await b.page.emulateMedia({ colorScheme: scheme });
      await setHostSettings(page, {
        bots: Array.from({ length: 12 }, () => ({ level: "clerk" as const })),
      });
      // host + guest + 12 bots: desks 1-14 cover all twelve inks at least once
      await expect(seatRing(page)).toHaveAccessibleName("Seat ring: 14 of 30 desks taken", {
        timeout: scaled(5_000),
      });
      const colours = await page.evaluate(() =>
        [...document.querySelectorAll("[data-seat-ring] [data-desk]")]
          .filter((c) => c.getAttribute("data-state") !== "empty")
          .map((c) => {
            const face = c.firstElementChild!;
            const initials = face.querySelector("[class*='initials']")!;
            const f = getComputedStyle(face);
            return {
              desk: c.getAttribute("data-desk"),
              state: c.getAttribute("data-state"),
              ink: c.getAttribute("data-ink"),
              text: getComputedStyle(initials).color,
              ground: f.backgroundColor,
              rule: f.borderTopColor,
              ruleWidth: f.borderTopWidth,
            };
          }),
      );
      expect(colours).toHaveLength(14);
      expect(new Set(colours.filter((c) => c.ink !== "you").map((c) => c.ink)).size).toBe(12);
      for (const c of colours) {
        const ratio = contrastRatio(rgbOf(c.text), rgbOf(c.ground));
        expect(ratio, `desk ${c.desk} initials`).toBeGreaterThanOrEqual(4.5);
        if (c.state === "you") continue;
        expect(c.ruleWidth).toBe("4px");
        expect(
          contrastRatio(rgbOf(c.rule), rgbOf(c.ground)),
          `desk ${c.desk} rule`,
        ).toBeGreaterThanOrEqual(3);
      }
      expect(colours.find((c) => c.state === "you")?.ground).toBe(await role(page, "--color-you"));
      await expectNoA11yViolations(page);
      await b.context.close();
    });
  }
});

// Contract C3 of #730: roll portraits behind lobby membership. A guest with an approved avatar (seeded
// as uploadAvatar leaves it, #64/#880 fixtures) and one without share a room: both rolls draw A's
// picture (loaded, 200 from the lobby-scoped route) and B's initials; a guest of another room gets 404
// for the same URL; a room mate who joins after A's picture is revoked sees the initials again.
const portrait = (page: Page, userId: string) =>
  roll(page).locator(`[data-portrait] img[src^="/api/avatars/${userId}?"]`);
const portraitCells = (page: Page) => roll(page).locator("[data-portrait]");

test.describe("lobby roll portraits (#730)", () => {
  // The cell is fixed-size; one project runs the flow (see.ts covers 375/768/1280).
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project only");

  const opened: BrowserContext[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  test.afterEach(async () => {
    for (const context of opened.splice(0)) await context.close();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  test("C3 room mates see the portrait; another room's guest gets 404; a refused picture falls back to initials", async ({
    page,
    browser,
  }) => {
    const code = await createLobby(page);
    const aId = await guestIdOf(page);
    cleanups.push(await seedAvatar(aId));
    // A's next race token carries the approved version: reload so A's seat takes it.
    await page.reload();
    await expect(portrait(page, aId)).toHaveCount(1, { timeout: ACTION_WAIT });

    const b = await joinAsGuest(browser, code);
    opened.push(b.context);
    for (const p of [page, b.page]) {
      await expect(rows(p)).toHaveCount(2, { timeout: ACTION_WAIT });
      const img = portrait(p, aId);
      await expect(img).toHaveAttribute("alt", "");
      await expect(img).toHaveAttribute("src", `/api/avatars/${aId}?size=64&v=${SEEDED_VERSION}`);
      await expect(roll(p).locator('[data-portrait="loaded"]')).toHaveCount(1, {
        timeout: ACTION_WAIT,
      });
      expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(
        true,
      );
      expect((await p.request.get((await img.getAttribute("src"))!)).status()).toBe(200);
      // B has no picture: its row keeps the initials, no img
      await expect(roll(p).locator('[data-portrait="initials"]')).toHaveCount(1);
      await expect(roll(p).locator('[data-portrait="initials"] img')).toHaveCount(0);
      const box = await roll(p).locator("[data-portrait]").first().boundingBox();
      expect(box).toMatchObject({ width: 32, height: 32 });
    }

    // Another room's guest asks for the same URL: 404 (#880).
    const outsider = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    opened.push(outsider);
    const outsiderPage = await outsider.newPage();
    await becomeGuest(outsiderPage);
    const src = `/api/avatars/${aId}?size=64&v=${SEEDED_VERSION}`;
    expect((await outsiderPage.request.get(src)).status()).toBe(404);

    // A's picture is revoked: a mate seated now still gets A's address from the roster, the route
    // refuses it, and the cell shows A's initials in the same square.
    await setAvatarStatus(aId, "NONE");
    const c = await joinAsGuest(browser, code);
    opened.push(c.context);
    await expect(rows(c.page)).toHaveCount(3, { timeout: ACTION_WAIT });
    await expect(portraitCells(c.page)).toHaveCount(3);
    await expect(roll(c.page).locator('[data-portrait="failed"]')).toHaveCount(1, {
      timeout: ACTION_WAIT,
    });
    await expect(roll(c.page).locator('[data-portrait="failed"] img')).toHaveCount(0);
    await expect(roll(c.page).locator('[data-portrait="failed"]')).toHaveText(/^\p{Lu}{1,2}$/u);
    const failedBox = await roll(c.page).locator('[data-portrait="failed"]').boundingBox();
    expect(failedBox).toMatchObject({ width: 32, height: 32 });
  });
});

async function setAvatarStatus(userId: string, status: "NONE" | "APPROVED") {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`UPDATE "User" SET "avatarStatus" = $1 WHERE id = $2`, [status, userId]);
  } finally {
    await db.end();
  }
}
