import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import Redis from "ioredis";
import { expect, expectNoA11yViolations, test } from "../fixtures";
import { createLobby, joinAsGuest } from "../race/helpers";
import { ACTION_WAIT, HYDRATION_WAIT, scaled } from "../timeouts";

// Card #809 (R213): /invite/[token] (the invitation, the refusal) and the host's LINK row in the room
// docket. The GET only peeks; TAKE YOUR DESK (a form post) consumes the link.

const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const rows = (page: Page) => roll(page).getByRole("listitem");
const linkLabel = (page: Page) => page.locator("dt", { hasText: /^LINK$/ });
const takeButton = (page: Page) => page.getByRole("button", { name: "TAKE YOUR DESK" });
const refusal = (page: Page) => page.getByText("LINK USED OR EXPIRED", { exact: true });
const joinForm = (page: Page) => page.getByRole("form", { name: "Join with code" });
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Within 2 s of the cue (R213), scaled on a loaded machine. */
const SOON = { timeout: scaled(2_000) };

const newToken = () => randomBytes(32).toString("base64url");

/** Files a token as createInvite does (`web:invite:<token>`, 10 min), for the screen-only tests. */
async function fileToken(token: string) {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set (load the .env)");
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  try {
    await redis.set(`web:invite:${token}`, "e2e-lobby", "EX", 600);
  } finally {
    redis.disconnect();
  }
}

/** Every visible button and link of the page's main at least 44px tall (bible 18). */
async function expectTallTargets(page: Page) {
  const heights = await page
    .locator("main")
    .locator("button:visible, a:visible")
    .evaluateAll((nodes) => nodes.map((n) => [n.textContent, n.getBoundingClientRect().height]));
  for (const [name, height] of heights)
    expect(height as number, String(name)).toBeGreaterThanOrEqual(44);
}

async function checkScreen(page: Page) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectNoA11yViolations(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  if ((page.viewportSize()?.width ?? 0) <= 375) await expectTallTargets(page);
}

test.describe("invite links (#809)", () => {
  test("C1 C3 C6 the invitation peeks, the refusal stamps, both accessible at every width", async ({
    page,
    request,
  }) => {
    expect((await request.get("/invite/not-a-token")).status()).toBe(404);

    const token = newToken();
    await fileToken(token);
    // opened twice without a press: the same invitation (the GET consumes nothing)
    for (let i = 0; i < 2; i++) {
      await page.goto(`/invite/${token}`);
      await expect(page.getByText("MINISTRY OF TYPING · INVITATION")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "YOU ARE EXPECTED" })).toBeVisible();
      await expect(page.locator("main dd")).toHaveText(["INVITE", "ONE"]);
      await expect(takeButton(page)).toBeVisible();
    }
    await checkScreen(page);

    await page.goto(`/invite/${newToken()}`);
    await expect(refusal(page)).toBeVisible();
    await expect(page.getByText("REFUSED", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Ask the host for a new link, or join with the room code."),
    ).toBeVisible();
    await expect(joinForm(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "REPORT TO YOUR DESK" }).last()).toHaveAttribute(
      "href",
      "/",
    );
    await checkScreen(page);
  });

  test("C4 C6 the host's LINK row issues a link; phones show no invite rows", async ({ page }) => {
    await createLobby(page);
    await expect(rows(page)).toHaveCount(1, { timeout: HYDRATION_WAIT });
    const width = page.viewportSize()?.width ?? 0;
    if (width <= 480) {
      await expect(linkLabel(page)).toBeHidden();
      await expect(page.getByRole("button", { name: "NEW LINK" })).toBeHidden();
      await checkScreen(page);
      return;
    }
    const newLink = page.getByRole("button", { name: "NEW LINK" });
    await expect(linkLabel(page)).toBeVisible();
    expect((await newLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await newLink.click();
    const url = page.getByRole("group", { name: "Invite link" });
    await expect(url).toContainText("/invite/", { timeout: ACTION_WAIT });
    const first = await url.textContent();
    await expect(url).toHaveAttribute("title", first!);
    await expect(url).toHaveCSS("text-overflow", "ellipsis");
    await expect(url).toHaveCSS("white-space", "nowrap");
    // a second press replaces the shown link with a new one
    await newLink.click();
    await expect(url).not.toHaveText(first!, { timeout: ACTION_WAIT });
    await checkScreen(page);
  });

  test("C2 C5 R213: two join by code, a link seats a fourth, its second use is refused", async ({
    page,
    browser,
  }) => {
    test.skip(test.info().project.name !== "desktop", "five contexts: desktop only (phones watch)");
    test.setTimeout(scaled(120_000));
    const code = await createLobby(page);
    await expect(rows(page)).toHaveCount(1, { timeout: HYDRATION_WAIT });

    const b = await joinAsGuest(browser, code);
    const c = await joinAsGuest(browser, code);
    const others = [b, c];
    const contexts = others.map((o) => o.context);
    try {
      await expect(rows(c.page)).toHaveCount(3, { timeout: HYDRATION_WAIT });
      for (const p of [page, b.page]) await expect(rows(p)).toHaveCount(3, SOON);

      // a guest never sees the LINK row
      await expect(linkLabel(b.page)).toHaveCount(0);

      await page.getByRole("button", { name: "NEW LINK" }).click();
      const shown = page.getByRole("group", { name: "Invite link" });
      await expect(shown).toContainText("/invite/", { timeout: ACTION_WAIT });
      // the issued URL's origin is NEXT_PUBLIC_APP_URL; the test server answers on its own port
      const path = new URL((await shown.textContent())!).pathname;
      const token = path.split("/").pop()!;

      const dCtx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
      contexts.push(dCtx);
      const d = await dCtx.newPage();
      await d.goto(path);
      await expect(takeButton(d)).toBeVisible({ timeout: HYDRATION_WAIT });
      await takeButton(d).click();
      await d.waitForURL(`**/lobby/${code}`, { timeout: ACTION_WAIT });
      await expect(rows(d)).toHaveCount(4, { timeout: HYDRATION_WAIT });
      for (const p of [page, b.page, c.page]) await expect(rows(p)).toHaveCount(4, SOON);

      // the token stays out of the lobby's URL, HTML and cookies
      expect(d.url()).not.toContain(token);
      // (the lobby's own document: the soft navigation keeps the invite page's payload in this DOM)
      expect(await (await dCtx.request.get(`/lobby/${code}`)).text()).not.toContain(token);
      expect(JSON.stringify(await dCtx.cookies())).not.toContain(token);

      const eCtx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
      contexts.push(eCtx);
      const e = await eCtx.newPage();
      await e.goto(path);
      await expect(refusal(e)).toBeVisible();
      await expect(joinForm(e)).toBeVisible();
      await expect(takeButton(e)).toHaveCount(0);
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });
});
