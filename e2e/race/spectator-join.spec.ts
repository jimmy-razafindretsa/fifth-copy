import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ACTION_WAIT, HYDRATION_WAIT, LOAD_LIMIT_MS, scaled } from "../timeouts";
import { hostRoom, simulatedPlayers, startButton, type SimulatedPlayer } from "./helpers";

// Contract of #999 C12 and C13 (ARCHITECTURE 7.8, ADR 0009): the host issues a reusable spectator link
// (the WATCH row); whoever opens `/watch/<token>` watches the room as a spectator with a guest made on
// demand, never takes a desk or a seat of the 30, and never receives the room code: not in the page,
// an action answer, the token or the `welcome` frame; `/race/<lobbyId>` asks such a viewer for the code.
// Real web app and race server (playwright.config.ts); the stage is the paper ring (`e2e/fixtures.ts`).

const roll = (page: Page) => page.getByRole("list", { name: "Typists in the room" });
const state = (page: Page) => page.locator("[data-projector-state]");

/** Every text a link holder's page received: action answers, race socket frames, decoded token claims. */
function receivedTexts(page: Page): string[] {
  const seen: string[] = [];
  void page.route("**/*", async (route, r) => {
    if (r.method() !== "POST" || !r.headers()["next-action"]) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    seen.push(body);
    for (const jwt of body.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) ?? [])
      seen.push(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"));
    await route.fulfill({ response, body });
  });
  // the race server's frames (`next dev`'s HMR socket lists every compiled route of the server)
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).pathname.startsWith("/_next/")) return;
    ws.on("framereceived", ({ payload }) => void seen.push(String(payload)));
  });
  return seen;
}

/** The room code in either spelling (`ABC-1234`, `ABC1234`) appears nowhere in `texts`. */
function expectNoCode(texts: string[], code: string) {
  const bare = code.replace("-", "");
  for (const text of texts) {
    expect(text).not.toContain(code);
    expect(text).not.toContain(bare);
  }
}

/** The host's WATCH row issues a link; its URL is the shown value (`/watch/<token>`). */
async function issueWatchLink(host: Page): Promise<string> {
  await host.getByRole("button", { name: "NEW WATCH LINK" }).click();
  const shown = host.getByRole("group", { name: "Spectator link" });
  await expect(shown).toContainText("/watch/", { timeout: ACTION_WAIT });
  return new URL((await shown.textContent())!.trim()).pathname;
}

test.describe("#999 spectator join flow", () => {
  const opened: BrowserContext[] = [];
  let players: SimulatedPlayer[] = [];
  test.afterEach(async () => {
    for (const p of players.splice(0)) p.close();
    for (const context of opened.splice(0)) await context.close();
  });

  test("C12 C13 a link holder watches as a guest spectator, outside the seats, and never learns the code", async ({
    browser,
  }, info) => {
    test.skip(info.project.use.viewport?.width !== 1280, "desktop project");
    test.setTimeout(scaled(150_000) + LOAD_LIMIT_MS);
    const { host, code, lobbyId } = await hostRoom(browser, opened);
    const watchPath = await issueWatchLink(host);

    const context = await browser.newContext({ baseURL: info.project.use.baseURL });
    opened.push(context);
    expect(await context.cookies()).toEqual([]);
    const page = await context.newPage();
    const seen = receivedTexts(page);
    await page.setViewportSize({ width: 1920, height: 1080 });

    // the server's HTML of the link carries no code
    seen.push(await (await page.request.get(watchPath)).text());
    await page.goto(watchPath);
    await expect(state(page)).toHaveAttribute("data-projector-state", "waiting", {
      timeout: HYDRATION_WAIT,
    });
    seen.push(await page.content());
    // a guest identity made on demand (ADR 0009), a spectator welcome without the code (protocol 21)
    expect((await context.cookies()).some((c) => c.name === "fc_guest")).toBe(true);
    const welcome = seen.find((t) => t.startsWith('42["welcome"'));
    expect(welcome).toBeDefined();
    expect(JSON.parse(welcome!.slice(2))[1]).toMatchObject({
      role: "spectator",
      you: null,
      room: { code: null },
    });
    expect(seen.some((t) => t.includes('"role":"spectator"'))).toBe(true);
    expectNoCode(seen, code);

    // outside the 30 seats: the host's roll and count are unchanged
    await expect(roll(host).getByRole("listitem")).toHaveCount(1);
    await expect(host.getByText("1 / 30", { exact: true })).toBeVisible();

    // the lobby id does not open the code: `/race/<lobbyId>` asks for it
    const race = await page.request.get(`/race/${lobbyId}`);
    const html = await race.text();
    expect(html).toContain("data-code-gate");
    expectNoCode([html], code);
    const lobby = await page.request.get(`/race/${lobbyId}?view=projector`);
    expect(await lobby.text()).toContain("data-code-gate");

    // the race starts with one more typist; the spectator follows it and a reload rejoins it
    players = await simulatedPlayers(1, lobbyId);
    await expect(roll(host).getByRole("listitem")).toHaveCount(2);
    await expect(startButton(host)).toBeEnabled({ timeout: ACTION_WAIT });
    await startButton(host).click();
    const live = /^(loading|countdown|racing)$/;
    await expect(state(page)).toHaveAttribute("data-projector-state", live, {
      timeout: scaled(30_000) + LOAD_LIMIT_MS,
    });
    await page.reload();
    await expect(state(page)).toHaveAttribute("data-projector-state", live, {
      timeout: HYDRATION_WAIT,
    });
    expectNoCode(seen, code);
  });

  test("C12 an unknown link is refused, with no spectator socket", async ({ page }) => {
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    await page.goto(`/watch/${"x".repeat(43)}`);
    await expect(page.getByText("LINK USED OR EXPIRED", { exact: true })).toBeVisible();
    await expect(state(page)).toHaveCount(0);
    expect(sockets.filter((u) => !u.includes("/_next/"))).toEqual([]);
  });
});
