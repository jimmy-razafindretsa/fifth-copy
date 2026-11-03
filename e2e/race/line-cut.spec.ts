import type { BrowserContext, Locator, Page, WebSocketRoute } from "@playwright/test";
import Redis from "ioredis";
import { SignJWT, decodeJwt } from "jose";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";
import {
  hostRoom,
  phaseOf,
  recordRaceTokens,
  SEAT_HUD,
  setHostSettings,
  startButton,
  warmRace,
} from "./helpers";

// Contract of #235 C3, C4 and C6 over the race server playwright.config.ts starts (ARCHITECTURE 7.4: a
// 2-minute grace, the race clock never pauses; ADR 0006 resume with the stored key, ADR 0007 the
// server's state wins on the fresh welcome). A host and one guest (English, the page under test).
// C3: the guest's network goes away for 3 s mid-race (`goOffline`: `context.setOffline`, plus the close of
// the live race socket, which Chromium's offline emulation leaves open, and the refusal of new ones until
// it comes back): the guest sees LINE CUT · RECONNECTING while the
// timer tube keeps counting down and the sheet keeps its typed characters; the host's race card shows
// LINE CUT on the guest's lane; back online the notice goes, the cursor has not moved and the next key
// advances it. C6: a reload resumes the desk at the server's progress; a reload whose first race token
// has expired (re-signed here with `exp` in the past, through the mint's response) mints once more and
// resumes. C4: a reconnect to a room that is gone (its Redis keys deleted while the guest is offline,
// as a Redis loss leaves it) is the lost room, with the way back to the lobby.

const notice = (page: Page) => page.locator("[data-seat-status] [data-notice]");
const done = (page: Page) => page.locator('[data-sheet] [data-state="done"]');
const nextChar = (page: Page) => page.locator('[data-sheet] [data-state="next"]');
const stripText = async (page: Page) =>
  (await page.locator("[data-telex] [data-state]").allTextContents()).join("");
const timer = (page: Page) => SEAT_HUD.nixie(page).locator('[data-tube="timer"]');
const seconds = async (tube: Locator) => {
  const m = /^(\d{2}):(\d{2})$/.exec((await tube.textContent()) ?? "");
  expect(m, "mm:ss").not.toBeNull();
  return Number(m![1]) * 60 + Number(m![2]);
};
const deskOf = async (page: Page) =>
  Number(/(\d{2})$/.exec((await SEAT_HUD.kicker(page).textContent()) ?? "")![1]);
const laneOf = (page: Page, desk: number) =>
  SEAT_HUD.raceCard(page).locator(`[data-lane][data-desk="${desk}"]`);

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

/**
 * The e2e seam of C6: the page's next race token mint answers a token whose `exp` is already past (the
 * same claims, signed with the local `RACE_TOKEN_SECRET`, issued 600 s ago for the 300 s TTL), so the
 * handshake is refused `bad-token`; every later mint passes untouched. Returns the mint count.
 */
async function expireNextRaceToken(page: Page) {
  const secret = process.env.RACE_TOKEN_SECRET;
  if (!secret) throw new Error("RACE_TOKEN_SECRET is not set (load the .env)");
  const record = { mints: 0, expired: false };
  await page.route("**/race/**", async (route) => {
    const r = route.request();
    if (r.method() !== "POST" || !r.headers()["next-action"]) return route.continue();
    record.mints++;
    const response = await route.fetch();
    let body = await response.text();
    const jwt = record.expired ? null : JWT.exec(body)?.[0];
    if (jwt) {
      const { iat, ...rest } = decodeJwt(jwt);
      const claims = { ...rest, exp: undefined };
      const issued = (iat ?? Math.floor(Date.now() / 1000)) - 600;
      const stale = await new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(issued)
        .setExpirationTime(issued + 300)
        .sign(new TextEncoder().encode(secret));
      body = body.replace(jwt, stale);
      record.expired = true;
    }
    await route.fulfill({ response, body });
  });
  return record;
}

/**
 * The guest's line to the race server, cuttable (#235 C3): every race socket of the page goes through a
 * `routeWebSocket` relay. `goOffline` sets the context offline (no polling fallback), closes the live
 * socket (the server sees the disconnect, the client starts reconnecting) and refuses new ones until
 * `goOnline`. Install before the page loads.
 */
async function cuttableLine(page: Page) {
  // page side -> server side; an `onClose` handler turns off Playwright's own close forwarding, so both
  // sides are closed here
  const live = new Map<WebSocketRoute, WebSocketRoute>();
  let offline = false;
  // An attempt made while offline stalls until `goOnline`, as on a dead network. Closing it instead
  // would hang the client: the page sees the mocked socket open then close before the engine.io
  // handshake, which socket.io's Manager only gives up on after its 20 s connect timeout.
  const held: Array<() => void> = [];
  await page.routeWebSocket(/\/socket\.io\//, async (ws) => {
    if (offline) await new Promise<void>((resume) => held.push(resume));
    const server = ws.connectToServer();
    live.set(ws, server);
    ws.onClose(() => {
      live.delete(ws);
      void server.close();
    });
    server.onClose(() => {
      live.delete(ws);
      void ws.close();
    });
  });
  return {
    async goOffline() {
      offline = true;
      await page.context().setOffline(true);
      for (const [ws, server] of [...live]) {
        live.delete(ws);
        await server.close();
        await ws.close({ code: 1001, reason: "offline" });
      }
    },
    async goOnline() {
      offline = false;
      await page.context().setOffline(false);
      for (const resume of held.splice(0)) resume();
    },
  };
}

/** Deletes every Redis key of the room (`room:<lobbyId>*`), as a Redis loss leaves it (#204). */
async function dropRoom(lobbyId: string) {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set (load the .env)");
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  try {
    const keys = await redis.keys(`room:${lobbyId}*`);
    expect(keys.length, "the room's keys").toBeGreaterThan(0);
    await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

test.describe("#235 line cut and reconnecting states", () => {
  test.skip(({ viewport }) => viewport?.width !== 1280, "desktop project");

  const opened: BrowserContext[] = [];
  test.afterEach(async ({ page }) => {
    await page.context().setOffline(false);
    for (const context of opened.splice(0)) await context.close();
  });

  /** A host and the guest page in a running race (`timerS` 60 when `timed`); returns both desks. */
  async function racing(page: Page, { timed = false } = {}) {
    const room = await hostRoom(page.context().browser()!, opened, { before: recordRaceTokens });
    await setHostSettings(room.host, { wordCount: 10, ...(timed ? { timerS: 60 } : {}) });
    const line = await cuttableLine(page);
    await page.goto(`/race/${room.lobbyId}`);
    await expect(SEAT_HUD.kicker(page)).toHaveText(/\d{2}$/, { timeout: scaled(20_000) });
    const guest = await deskOf(page);
    await expect(startButton(room.host)).toBeEnabled();
    await warmRace(room.host, room.lobbyId);
    await startButton(room.host).click();
    await expect(room.host).toHaveURL(/\/race\/[0-9a-f-]{36}$/);
    for (const p of [page, room.host]) {
      await expect(phaseOf(p)).toHaveAttribute("data-phase", "running", {
        timeout: scaled(15_000),
      });
    }
    const text = Array.from(await stripText(page));
    return { ...room, guest, text, line };
  }

  /** The guest types `n` more correct keys; the host's card shows the guest's desk at `to`. */
  async function typeTo(page: Page, host: Page, guest: number, text: string[], to: number) {
    const from = await done(page).count();
    await page.keyboard.type(text.slice(from, to).join(""), { delay: 40 });
    await expect(done(page)).toHaveCount(to);
    await expect(laneOf(host, guest)).toHaveAttribute("data-desk-progress", String(to), {
      timeout: scaled(5_000),
    });
  }

  test("C3 offline for 3 s: LINE CUT · RECONNECTING with the clock running and the sheet kept; the host sees LINE CUT; back online the cursor resumes", async ({
    page,
  }) => {
    test.setTimeout(scaled(120_000));
    const { host, guest, text, line } = await racing(page, { timed: true });
    await typeTo(page, host, guest, text, 4);
    const before = await seconds(timer(page));

    await line.goOffline();
    const cutAt = Date.now();
    await expect(notice(page)).toHaveAttribute("data-notice", "reconnecting", {
      timeout: scaled(5_000),
    });
    await expect(
      page.getByRole("status").filter({ hasText: "LINE CUT · RECONNECTING" }),
    ).toBeVisible();
    // the race goes on for the host: the guest's lane reads LINE CUT, its marker dims
    const lane = laneOf(host, guest);
    await expect(lane).toHaveAttribute("data-status", "line-cut", { timeout: scaled(5_000) });
    await expect(lane.locator("[data-status-label]")).toHaveText("LINE CUT");
    await expect(lane).toHaveAttribute("aria-label", /, LINE CUT$/);
    // the guest's sheet keeps what it typed, its input takes nothing
    await page.keyboard.type(text[4]!);
    await expect(done(page)).toHaveCount(4);
    await page.waitForTimeout(Math.max(0, 3_000 - (Date.now() - cutAt)));
    // the timer tube kept counting down from this device's clock through the cut
    expect(await seconds(timer(page)), "the timer tube kept running").toBeLessThanOrEqual(
      before - 2,
    );
    await expect(notice(page)).toHaveAttribute("data-notice", "reconnecting");

    await line.goOnline();
    await expect(notice(page)).toHaveCount(0, { timeout: scaled(15_000) });
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running");
    await expect(lane).toHaveAttribute("data-status", "typing", { timeout: scaled(5_000) });
    // the cursor is where it was; the next key advances it
    await expect(done(page)).toHaveCount(4);
    await expect(nextChar(page)).toHaveCount(1);
    await typeTo(page, host, guest, text, 5);
  });

  test("C6 a reload resumes at the server's progress; an expired token on the reload re-mints once and resumes", async ({
    page,
  }) => {
    test.setTimeout(scaled(120_000));
    const { host, guest, text } = await racing(page);
    await typeTo(page, host, guest, text, 5);

    await page.reload();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(15_000),
    });
    // the fresh welcome's state: the five keys the server holds, same desk
    await expect(done(page)).toHaveCount(5, { timeout: scaled(5_000) });
    expect(await deskOf(page)).toBe(guest);
    await expect(laneOf(host, guest)).toHaveAttribute("data-status", "typing", {
      timeout: scaled(5_000),
    });
    await expect(laneOf(host, guest).locator("[data-status-label]")).toHaveCount(0);
    await typeTo(page, host, guest, text, 6);

    // the reload's first token is already expired: bad-token, one more mint, the desk resumes
    const seam = await expireNextRaceToken(page);
    await page.reload();
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "running", {
      timeout: scaled(20_000),
    });
    expect(seam.expired, "the first token was expired").toBe(true);
    expect(seam.mints, "one re-mint").toBe(2);
    await expect(done(page)).toHaveCount(6, { timeout: scaled(5_000) });
    expect(await deskOf(page)).toBe(guest);
    await expect(page.locator("[data-seat-status] [data-lost]")).toHaveCount(0);
    await expect(laneOf(host, guest)).toHaveAttribute("data-status", "typing", {
      timeout: scaled(5_000),
    });
    await typeTo(page, host, guest, text, 7);
  });

  test("C4 a reconnect to a room that is gone: THE ROOM WAS LOST · BACK TO THE LOBBY, linking to the lobby", async ({
    page,
  }) => {
    test.setTimeout(scaled(120_000));
    const { guest, host, text, code, lobbyId, line } = await racing(page);
    await typeTo(page, host, guest, text, 3);

    await line.goOffline();
    await expect(notice(page)).toHaveAttribute("data-notice", "reconnecting", {
      timeout: scaled(5_000),
    });
    await dropRoom(lobbyId);
    await line.goOnline();

    const lost = page.locator('[data-seat-status] [data-lost="room-lost"]');
    await expect(lost).toBeVisible({ timeout: scaled(15_000) });
    await expect(lost.getByRole("alert")).toHaveText("THE ROOM WAS LOST · BACK TO THE LOBBY");
    const back = lost.getByRole("link", { name: "BACK TO THE LOBBY", exact: true });
    await expect(back).toHaveAttribute("href", `/lobby/${code}`);
    const box = (await back.boundingBox())!;
    expect(box.height, "a 44px hit area").toBeGreaterThanOrEqual(44);
    await expect(phaseOf(page)).toHaveAttribute("data-phase", "lost");
    await expect(page.getByRole("textbox", { name: "Text to type" })).toBeDisabled();
  });
});
