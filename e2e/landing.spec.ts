import type { Page } from "@playwright/test";
import { expect, expectNoA11yViolations, test } from "./fixtures";

// Contract of #497 (with #489, #373): the whole landing of bible 14.1, ported from
// docs/design/bible/Fifth Copy Landing.dc.html. next/font renames families, so they are matched by
// regex; colour roles are resolved to rgb through a probe element.

const KICKER = "MINISTRY OF TYPING · DESK 05 · 1978";
const TAGLINE = "TYPE FAST · TYPE FIRST";
const PITCH =
  "Thirty desks. One message. Everyone types the same copy, and the fastest clean copy gets the medal.";
const SENTENCE = "Type fast. Type first.";
const STORY = "THE RING ROOMS NEVER STOP TYPING.";
const STORY_FR = "LES SALLES EN ANNEAU NE S'ARRÊTENT JAMAIS DE TAPER.";
const QUICK = "QUICK RACE";

/** Computed rgb of a colour role, e.g. `role(page, "--color-fg")`; fails on an unemitted variable. */
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

const hero = (page: Page) => page.locator("section#play");
const tapeInput = (page: Page) => page.getByLabel("Typing practice");
const tapeStamp = (page: Page) => page.locator("[data-tape] output");
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Server-action re-renders on a loaded dev server take a few seconds. */
const AFTER_ACTION = { timeout: 20_000 };

/** The live feed's recorded loop (#552). */
const feedVideo = (page: Page) => hero(page).locator("video[aria-hidden='true']");

/**
 * Loads the landing and waits for hydration: the live-feed video leaves `data-feed="idle"` only on the
 * client, so `armed` or `near` means the tree is interactive (controlled inputs keep what is typed).
 */
async function ready(page: Page) {
  await page.goto("/");
  await expect(feedVideo(page)).toHaveAttribute("data-feed", /^(armed|near)$/, {
    timeout: 30_000,
  });
}

test.describe("landing page (#497)", () => {
  // two WebGL embeds and a video per page: give parallel workers room (CI runs `next start`, dev is slower)
  test.beforeEach(() => test.slow());

  test("C1 the bible's sections in order, one h1 and the section headings", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("FIFTH COPY · TYPE FAST · TYPE FIRST");
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("header, main > section, footer")].map(
        (el) =>
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : "") +
          (el.getAttribute("aria-labelledby") ? `[${el.getAttribute("aria-labelledby")}]` : "") +
          (el.getAttribute("aria-hidden") === "true" ? "(hidden)" : ""),
      ),
    );
    expect(order).toEqual([
      "header",
      "section#play[hero-title]",
      "section(hidden)",
      "section[story-title]",
      "section[clerk-title]",
      "section[history-title]",
      "section#how[how-title]",
      "section[final-title]",
      "section[medal-title]",
      "footer",
    ]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const h2s = await page.getByRole("heading", { level: 2 }).allTextContents();
    expect(h2s).toEqual([
      STORY,
      "THIS IS YOUR CLERK.",
      "A LITTLE HISTORY",
      "HOW A RACE RUNS",
      "REPORT TO YOUR DESK.",
      "HERO OF PAPERWORK",
    ]);
    await expect(hero(page).getByText(KICKER, { exact: true })).toBeVisible();
    await expect(hero(page).getByText(TAGLINE, { exact: true })).toBeVisible();
    await expect(hero(page).getByText(PITCH, { exact: true })).toBeVisible();
  });

  test("C2 header: brand link, guide link, EN/FR, NIGHT SHIFT, SIGN IN; no docket before a guest exists", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "FIFTH COPY" })).toHaveAttribute("href", "/");
    const nav = header.getByRole("navigation", { name: "Site" });
    await expect(nav.getByRole("link", { name: "HOW TO TYPE É Ç « »" })).toHaveAttribute(
      "href",
      "#how",
    );
    const language = nav.getByRole("group", { name: "Language" });
    await expect(language.getByRole("button", { name: "EN", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(language.getByRole("button", { name: "FR", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(nav.getByRole("button", { name: "NIGHT SHIFT" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "SIGN IN" })).toHaveAttribute("href", "/sign-in");
    await expect(nav.getByText("GUEST", { exact: true })).toHaveCount(0);
    const kicker = await hero(page)
      .getByText(KICKER, { exact: true })
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { family: s.fontFamily, spacing: s.letterSpacing };
      });
    expect(kicker.family).toMatch(/Oswald/i);
    expect(kicker.spacing).toBe("3.12px");
  });

  test("C3 EN/FR switches the whole page and is remembered (ADR 0010)", async ({ page }) => {
    await ready(page);
    await page.getByRole("button", { name: "FR", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: STORY_FR })).toBeVisible(AFTER_ACTION);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("button", { name: "FR", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "COURSE RAPIDE" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "QUART DE NUIT" })).toBeVisible();
    // one language at a time (bible 2): no English section heading is left
    await expect(page.getByRole("heading", { level: 2, name: STORY })).toHaveCount(0);
    await expect(page.locator("[data-tape]")).toContainText("Écris vite. Écris le premier.");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 2, name: STORY_FR })).toBeVisible(AFTER_ACTION);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: STORY })).toBeVisible(AFTER_ACTION);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("C4 NIGHT SHIFT switches the theme at once, lights the gold dot and is remembered", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await ready(page);
    const toggle = page.getByRole("button", { name: "NIGHT SHIFT" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", AFTER_ACTION);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const gold = await role(page, "--color-reward");
    await expect(toggle.locator("span").first()).toHaveCSS("background-color", gold);
    const night = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(night).not.toBe(paper);
    expect(night).toBe(await role(page, "--color-bg"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "NIGHT SHIFT" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "NIGHT SHIFT" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light", AFTER_ACTION);
  });

  test("C5 the typing strip stamps ACCEPTED with WPM, RETURNED with errors, and resets", async ({
    page,
  }) => {
    await ready(page);
    const input = tapeInput(page);
    await expect(tapeStamp(page)).toHaveText("");
    const chars = page.locator("[data-tape] [data-state]");
    await expect(chars).toHaveCount(SENTENCE.length);
    await expect(chars.first()).toHaveAttribute("data-state", "next");
    await input.pressSequentially(SENTENCE);
    await expect(tapeStamp(page)).toHaveText(/^ACCEPTED · \d+ WPM$/);
    await expect(chars.last()).toHaveAttribute("data-state", "done");
    await page.getByRole("button", { name: "↺ AGAIN" }).click();
    await expect(tapeStamp(page)).toHaveText("");
    await expect(input).toHaveValue("");
    await input.pressSequentially("Tyxe fast. Type first.");
    await expect(tapeStamp(page)).toHaveText("RETURNED · 1 ERRORS");
    await expect(chars.nth(2)).toHaveAttribute("data-state", "wrong");
    const font = await chars.first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toMatch(/IBM.?Plex.?Mono/i);
  });

  test("C6 the live feed frame: LIVE badge, ticking room chip, CAM, caption, view toggle, bobbing stamp", async ({
    page,
  }) => {
    await ready(page);
    const aside = feedVideo(page).locator("xpath=ancestor::div[2]");
    await expect(aside.getByText("LIVE", { exact: true })).toBeVisible();
    const chip = aside.getByText(/^ROOM \d{3} · \d\d:\d\d:\d\d$/);
    await expect(chip).toBeVisible();
    const before = await chip.textContent();
    await page.waitForTimeout(1200);
    expect(await chip.textContent()).not.toBe(before);
    const room = /ROOM (\d{3})/.exec(before ?? "")?.[1];
    await expect(
      aside.getByText(`STREAMING · Room ${room}, one of the ring rooms. Right now.`),
    ).toBeVisible();
    await expect(aside.getByText("CAM 02 · 30/30")).toBeVisible();
    const views = aside.getByRole("group", { name: "Camera" });
    await expect(views.getByRole("button", { name: "AUTO" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await views.getByRole("button", { name: "FIRST PERSON" }).click();
    await expect(views.getByRole("button", { name: "FIRST PERSON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(views.getByRole("button", { name: "AUTO" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const stamp = aside.locator("[aria-hidden='true']").filter({ hasText: `ROOM ${room}` });
    await expect(stamp).toContainText("30 SEATS");
    expect(await stamp.evaluate((el) => getComputedStyle(el).animationName)).toMatch(/fcBob$/);
    // #552: the feed is a recorded loop, no longer the lobby embed
    await expect(hero(page).locator("iframe")).toHaveCount(0);
  });

  test("C7 the three embeds are the bible's reference pages, served locally and mounted lazily", async ({
    page,
    request,
  }) => {
    await ready(page);
    const frames = page.locator("iframe");
    // the live feed is a recorded loop since #552; lobby.html stays served for the lobby scene
    await expect(frames).toHaveCount(2);
    const titles = await frames.evaluateAll((els) => els.map((el) => el.getAttribute("title")));
    expect(titles).toEqual([
      "Your clerk, a randomly issued 3D character",
      "3D medal you can earn, drag to spin",
    ]);
    // below the fold: not mounted until scrolled near
    await expect(frames.nth(1)).toHaveAttribute("data-embed", "idle");
    await frames.nth(1).scrollIntoViewIfNeeded();
    await expect(frames.nth(1)).toHaveAttribute("data-embed", "mounted", AFTER_ACTION);
    await expect(frames.nth(1)).toHaveAttribute("src", "/3d/medal.html");
    for (const path of ["/3d/lobby.html", "/3d/clerk.html", "/3d/medal.html"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const html = await res.text();
      expect(html).toContain("/3d/vendor/three.module.min.js");
      expect(html).not.toMatch(/unpkg|googleapis/);
    }
    for (const path of ["/3d/vendor/three.module.min.js", "/3d/fonts/embed-fonts.css"]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });

  test("C8 the clerk embed fills the personnel file through fc-clerk (bible 15)", async ({
    page,
  }) => {
    await ready(page);
    const webgl = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    test.skip(!webgl, "no WebGL in this browser");
    test.setTimeout(120_000);
    const rows = page.locator("[aria-labelledby='clerk-title'] dd");
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toHaveText("…");
    await expect(page.locator("[aria-labelledby='clerk-title'] dl")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await rows.first().scrollIntoViewIfNeeded();
    await expect(rows.first()).not.toHaveText("…", { timeout: 20_000 });
    const values = await rows.allTextContents();
    expect(values.every((v) => v.length > 1 && v !== "…")).toBe(true);
    await expect(page.getByText("UNASSIGNED", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "REISSUE UNIFORM" })).toBeVisible();
    await expect(page.getByRole("link", { name: "OPEN THE LOCKER →" })).toHaveAttribute(
      "href",
      "/locker",
    );
    await expect(page.locator("[aria-labelledby='clerk-title'] ol li")).toHaveText([
      "RECRUIT",
      "CLERK",
      "OFFICER",
      "COMMISSAR",
      "HERO OF PAPERWORK",
    ]);
  });

  test("C9 ticker, history, how, final call and footer carry the bible's copy and recipes", async ({
    page,
  }) => {
    await page.goto("/");
    const primary = await role(page, "--color-primary");
    const ticker = page.locator("main > section[aria-hidden='true']");
    const words = await ticker.locator("span > span").allTextContents();
    expect(words).toEqual([
      ...["TYPE FAST", "TYPE FIRST", "NO TYPOS", "THIRTY DESKS", "ONE MESSAGE"],
      ...["TYPE FAST", "TYPE FIRST", "NO TYPOS", "THIRTY DESKS", "ONE MESSAGE"],
    ]);
    expect(
      await ticker.locator("> div").evaluate((el) => getComputedStyle(el).animationName),
    ).toMatch(/fcMarquee$/);

    await expect(page.locator("[aria-labelledby='history-title'] h3")).toHaveText([
      "THE TYPING POOL",
      "MACHINES ON FILE",
      "CARBON COPIES",
      "SAMIZDAT",
    ]);
    const steps = page.locator("#how li");
    await expect(steps).toHaveCount(3);
    const rules = await steps.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).borderTopColor),
    );
    expect(rules[0]).toBe(primary);
    expect(rules[1]).toBe(await role(page, "--color-fg"));
    expect(rules[2]).toBe(await role(page, "--color-rival"));

    const final = page.locator("[aria-labelledby='final-title']");
    expect(await final.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(primary);
    await expect(final.getByRole("button", { name: QUICK })).toBeVisible();
    await expect(page.getByRole("button", { name: QUICK })).toHaveCount(2);

    const footer = page.locator("footer");
    for (const name of ["PLAY", "LEARN", "AEGIS CORP."]) {
      await expect(footer.getByRole("navigation", { name })).toBeVisible();
    }
    await expect(footer.getByRole("navigation").getByRole("link")).toHaveCount(11);
    const social = footer.getByRole("list").getByRole("link");
    await expect(social).toHaveCount(4);
    for (const link of await social.all()) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
    await expect(footer.getByText("BUILT BYAEGIS CORP.")).toBeVisible();
    await expect(
      footer.getByText("© 2026 Fifth Copy · Built by Aegis Corp. · Made in Québec"),
    ).toBeVisible();
    await expect(footer.getByText("No email. No chat. Your typing stays yours.")).toBeVisible();
    expect(await footer.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("14px");
  });

  test("C10 QUICK RACE opens a room and the header then files the guest", async ({ page }) => {
    await ready(page);
    await hero(page).getByRole("button", { name: QUICK }).click();
    await page.waitForURL(/\/lobby\/[A-Z]{3}-\d{4}$/);
    const docket = page.locator("header").getByText("GUEST", { exact: true });
    await expect(docket).toBeVisible();
    await expect(docket.locator("xpath=..")).toContainText(/^Comrade [A-Za-zÀ-ÿ]+-\d{3,4}GUEST$/);
  });

  test("C11 reduced motion stops marquee, stars, bob and the caret blink", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .map((el) => getComputedStyle(el))
        // every keyframe stops in its own reduce block (#28: no global duration clamp any more)
        .filter((s) => s.animationName !== "none" && parseFloat(s.animationDuration) > 0.001)
        .map((s) => s.animationName),
    );
    expect(animated).toEqual([]);
    const next = page.locator("[data-tape] [data-state='next']");
    await expect(next).toHaveCSS("background-color", await role(page, "--color-typing-next-bg"));
  });

  test("#28 reduced motion: a newly typed character does not pop in", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await tapeInput(page).pressSequentially("T");
    const typed = page.locator("[data-tape] [data-last='true']");
    await expect(typed).toHaveCount(1);
    await expect(typed).toHaveCSS("animation-name", "none");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C12 ${scheme}: accessible, no horizontal scroll, in both languages`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await ready(page);
      await expect(page.getByRole("heading", { level: 1, name: "Fifth Copy" })).toBeVisible();
      await expectNoA11yViolations(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "FR", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: STORY_FR })).toBeVisible(
        AFTER_ACTION,
      );
      await expectNoA11yViolations(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

// Contract of #552: the live feed plays a recorded loop of the ring room instead of the 3D embed
// (bible 7.8, 14.1 item 2). Media fetches use Range requests, so requests are counted by distinct URL.
const isClip = (url: string) =>
  /\/media\/live-feed\/[a-z]+\.(mp4|webm)$/.test(new URL(url).pathname);

function clipRequests(page: Page): Set<string> {
  const urls = new Set<string>();
  page.on("request", (req) => {
    if (isClip(req.url())) urls.add(new URL(req.url()).pathname);
  });
  return urls;
}

const media = (page: Page) =>
  feedVideo(page).evaluate((v: HTMLVideoElement) => ({
    paused: v.paused,
    muted: v.muted,
    time: v.currentTime,
    readyState: v.readyState,
    src: v.currentSrc,
  }));

/** After hydration (`ready`), sets the motion attribute like the settings card will (#28). */
async function reduceByAttribute(page: Page) {
  await page.evaluate(() => document.documentElement.setAttribute("data-motion", "reduce"));
}

test.describe("landing live feed video (#552)", () => {
  test.beforeEach(() => test.slow());

  test("C1 live feed video: a decorative muted inline loop with MP4 and WebM sources and a poster, no lobby embed", async ({
    page,
  }) => {
    const lobby: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.startsWith("/3d/lobby.html")) lobby.push(req.url());
    });
    await ready(page);
    const video = feedVideo(page);
    await expect(video).toHaveCount(1);
    await video.scrollIntoViewIfNeeded();
    await expect(video).toHaveAttribute("data-feed", "near", AFTER_ACTION);
    await expect(video).toHaveAttribute("loop", "");
    await expect(video).toHaveAttribute("playsinline", "");
    await expect(video).toHaveAttribute("aria-hidden", "true");
    await expect(video).toHaveAttribute("poster", "/media/live-feed/poster.webp");
    await expect(video).not.toHaveAttribute("controls");
    await expect(video).not.toHaveAttribute("autoplay");
    await expect.poll(async () => (await media(page)).muted).toBe(true);
    const sources = await video
      .locator("source")
      .evaluateAll((els) => els.map((el) => [el.getAttribute("src"), el.getAttribute("type")]));
    expect(sources).toEqual([
      ["/media/live-feed/auto.mp4", 'video/mp4; codecs="avc1.42E01E"'],
      ["/media/live-feed/auto.webm", 'video/webm; codecs="vp9"'],
    ]);
    expect((await page.request.get("/media/live-feed/poster.webp")).status()).toBe(200);
    // the whole page, every lazy embed included, never asks for the lobby scene
    await page.locator("footer").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    expect(lobby).toEqual([]);
    await expect(page.locator("iframe[src*='lobby']")).toHaveCount(0);
  });

  test("C2 live feed video: nothing loads until near the viewport, then only the selected view's loop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 480 });
    const clips = clipRequests(page);
    await ready(page);
    const video = feedVideo(page);
    await expect(video).toHaveAttribute("data-feed", "armed");
    await page.waitForTimeout(1000);
    expect([...clips]).toEqual([]);
    await expect(video.locator("source")).toHaveCount(0);
    await video.scrollIntoViewIfNeeded();
    await expect(video).toHaveAttribute("data-feed", "near", AFTER_ACTION);
    await expect.poll(() => clips.size, AFTER_ACTION).toBe(1);
    expect([...clips][0]).toMatch(/^\/media\/live-feed\/auto\.(mp4|webm)$/);
    await page.waitForTimeout(1000);
    expect(clips.size).toBe(1);
    await page
      .getByRole("group", { name: "Camera" })
      .getByRole("button", { name: "FIRST PERSON" })
      .click();
    await expect.poll(() => clips.size, AFTER_ACTION).toBe(2);
    expect([...clips][1]).toMatch(/^\/media\/live-feed\/pov\.(mp4|webm)$/);
    await expect.poll(async () => (await media(page)).src).toMatch(/\/pov\.(mp4|webm)$/);
  });

  test("C4 live feed video: under reduced motion it never plays and shows the poster", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const clips = clipRequests(page);
    await ready(page);
    const video = feedVideo(page);
    await video.scrollIntoViewIfNeeded();
    await expect(video).toHaveAttribute("data-feed", "near", AFTER_ACTION);
    await page.waitForTimeout(1500);
    const m = await media(page);
    expect(m.paused).toBe(true);
    expect(m.time).toBe(0);
    expect(m.readyState).toBe(0); // no frame decoded: the poster is what shows
    await expect(video).toHaveAttribute("poster", "/media/live-feed/poster.webp");
    expect([...clips]).toEqual([]);
  });

  test("C4 live feed video: data-motion=reduce set after hydration stops it back on the poster", async ({
    page,
  }) => {
    await ready(page);
    const video = feedVideo(page);
    await video.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await media(page)).paused, AFTER_ACTION).toBe(false);
    await reduceByAttribute(page);
    await expect.poll(async () => (await media(page)).paused).toBe(true);
    await expect.poll(async () => (await media(page)).readyState).toBe(0);
    expect((await media(page)).time).toBe(0);
  });

  test("C5 live feed video: pauses off screen and plays again on return", async ({ page }) => {
    await ready(page);
    const video = feedVideo(page);
    await video.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await media(page)).paused, AFTER_ACTION).toBe(false);
    await page.locator("footer").scrollIntoViewIfNeeded();
    await expect.poll(async () => (await media(page)).paused).toBe(true);
    await video.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await media(page)).paused, AFTER_ACTION).toBe(false);
  });
});

// Contract of #99: the lobby entries in the hero actions row (bible 7.1, 7.2, 7.4).
const CREATE = "CREATE PRIVATE RACE";
const JOIN_FIELD = "JOIN WITH CODE";
const JOIN = "JOIN →";

const createButton = (page: Page) => page.getByRole("button", { name: CREATE, exact: true });
const joinForm = (page: Page) => page.getByRole("form", { name: "Join with code" });
const codeField = (page: Page) => joinForm(page).getByLabel(JOIN_FIELD, { exact: true });
const joinButton = (page: Page) => joinForm(page).getByRole("button", { name: JOIN, exact: true });

test.describe("landing lobby entries (#99)", () => {
  test("C1 create and join forms are siblings in the wrapping row after the pitch", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(createButton(page)).toBeVisible();
    await expect(codeField(page)).toBeVisible();
    await expect(joinButton(page)).toBeVisible();
    const layout = await page.evaluate(
      ({ create, pitch }) => {
        const button = [...document.querySelectorAll("button")].find(
          (b) => b.textContent === create,
        );
        const createForm = button?.closest("form");
        const join = document.querySelector('form[aria-label="Join with code"]');
        const pitchEl = [...document.querySelectorAll("p")].find((p) => p.textContent === pitch);
        const row = createForm?.parentElement;
        return {
          onlyButton: createForm?.querySelectorAll("button, input").length,
          siblings: !!row && row === join?.parentElement,
          createFirst: !!(
            createForm &&
            join &&
            createForm.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
          afterPitch: !!(
            pitchEl &&
            row &&
            pitchEl.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
          display: row && getComputedStyle(row).display,
          wrap: row && getComputedStyle(row).flexWrap,
        };
      },
      { create: CREATE, pitch: PITCH },
    );
    expect(layout).toEqual({
      onlyButton: 1,
      siblings: true,
      createFirst: true,
      afterPitch: true,
      display: "flex",
      wrap: "wrap",
    });
  });

  test("C2 the code field masks as you type and uses the code face", async ({ page }) => {
    await page.goto("/");
    const field = codeField(page);
    await field.pressSequentially("kgb4821");
    await expect(field).toHaveValue("KGB-4821");
    await expect(field).toHaveAttribute("maxlength", "8");
    await expect(field).toHaveAttribute("autocapitalize", "characters");
    await expect(field).toHaveAttribute("inputmode", "text");
    await expect(field).toHaveAttribute("spellcheck", "false");
    await expect(field).toHaveAttribute("placeholder", "KGB-4821");
    const font = await field.evaluate((el) => {
      const s = getComputedStyle(el);
      return { family: s.fontFamily, size: s.fontSize, spacing: s.letterSpacing };
    });
    expect(font.family).toMatch(/IBM.?Plex.?Mono/i);
    expect(font).toMatchObject({ size: "18px", spacing: "1.44px" });
  });

  test("C3 a malformed code is rejected inline with no request", async ({ page }) => {
    await page.goto("/");
    const posts: string[] = [];
    page.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
    const field = codeField(page);
    await field.pressSequentially("KG-1");
    await joinButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "Enter a code like KGB-4821" });
    await expect(alert).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const errorId = await alert.getAttribute("id");
    expect(errorId).toBeTruthy();
    await expect(field).toHaveAttribute("aria-describedby", errorId!);
    await page.waitForTimeout(300);
    expect(posts).toEqual([]);
  });

  test("C4 a server error renders the docket error line and the form stays usable", async ({
    page,
  }) => {
    await page.goto("/");
    const primary = await role(page, "--color-primary");
    const fg = await role(page, "--color-fg");
    const surface = await role(page, "--color-surface");
    const field = codeField(page);
    await field.pressSequentially("ZZZ0000");
    await expect(field).toHaveValue("ZZZ-0000");
    await joinButton(page).click();
    const alert = joinForm(page).getByRole("alert").filter({ hasText: "RETURNED ·" });
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("ZZZ");
    const style = await alert.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        bg: s.backgroundColor,
        color: s.color,
      };
    });
    expect(style).toEqual({ border: `2px solid ${fg}`, bg: surface, color: primary });
    await expect(field).toBeEnabled();
    await expect(joinButton(page)).toBeEnabled();
    await field.fill("");
    await field.pressSequentially("abc");
    await expect(field).toHaveValue("ABC");
  });

  test("C6 controls follow the bible recipe through tokens", async ({ page }) => {
    await page.goto("/");
    const fg = await role(page, "--color-fg");
    const bg = await role(page, "--color-bg");
    const surface = await role(page, "--color-surface");

    const create = await createButton(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        family: s.fontFamily,
        size: s.fontSize,
        spacing: s.letterSpacing,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        bg: s.backgroundColor,
        radius: s.borderRadius,
        shadow: s.boxShadow,
      };
    });
    expect(create.family).toMatch(/Oswald/i);
    expect(create).toMatchObject({
      size: "13px",
      spacing: "2.08px",
      border: `2px solid ${fg}`,
      bg: "rgba(0, 0, 0, 0)",
      radius: "0px",
      shadow: "none",
    });

    const submit = await joinButton(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(submit).toEqual({ bg: fg, color: bg });

    const group = await codeField(page).evaluate((el) => {
      const s = getComputedStyle(el.parentElement!);
      return {
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        bg: s.backgroundColor,
      };
    });
    expect(group).toEqual({ border: `2px solid ${fg}`, bg: surface });

    if (test.info().project.name !== "desktop") {
      for (const control of [createButton(page), codeField(page), joinButton(page)]) {
        const box = await control.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`C8 ${scheme}: entries and error line are accessible, no horizontal scroll`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await codeField(page).pressSequentially("KG");
      await joinButton(page).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Enter a code like KGB-4821" }),
      ).toBeVisible();
      await expectNoA11yViolations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
