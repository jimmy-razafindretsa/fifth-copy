import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { SignJWT } from "jose";
import { Client } from "pg";
import { io, type Socket } from "socket.io-client";
import { charsOf, normalizeTypeable } from "@fifth-copy/engine";
import {
  MAX_KEYS_PER_BATCH,
  PROTOCOL_VERSION,
  RACE_TOKEN_TTL_S,
  type Countdown,
  type RaceSettings,
  type RaceSettingsPatch,
  type Welcome,
} from "@fifth-copy/protocol";
import { expect, test } from "../fixtures";
import { scaled } from "../timeouts";

// Room helpers shared by the lobby and race specs (#561 C10; first written for #107 in e2e/lobby.spec.ts).
// They drive the real landing and the race server started by playwright.config.ts.

export const LOBBY_PATH = /^\/lobby\/([A-HJ-NP-Z]{3}-[0-9]{4})$/;

/** Creates a private race from the landing and returns its code; the page stays in the waiting room. */
export async function createLobby(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "CREATE PRIVATE RACE", exact: true }).click();
  await page.waitForURL((url) => LOBBY_PATH.test(url.pathname));
  return LOBBY_PATH.exec(new URL(page.url()).pathname)![1]!;
}

/**
 * A different guest (fresh context) joins with the code from the landing. `before` runs on the new page
 * before it loads anything (init scripts, socket listeners: #214).
 */
export async function joinAsGuest(
  browser: Browser,
  code: string,
  { before }: { before?: (page: Page) => Promise<void> } = {},
) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await before?.(page);
  await page.goto("/");
  const form = page.getByRole("form", { name: "Join with code" });
  await form.getByLabel("JOIN WITH CODE", { exact: true }).pressSequentially(code);
  await form.getByRole("button", { name: "JOIN →", exact: true }).click();
  await page.waitForURL(`**/lobby/${code}`);
  return { context, page };
}

/** Runs `fn` against the card's dev database (DATABASE_URL from the worktree's .env). */
async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** The `Lobby.id` behind a room code: the id `/race/[raceId]` takes before any start. */
export function lobbyIdOf(code: string): Promise<string> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM "Lobby" WHERE code = $1`, [
      code,
    ]);
    if (!rows[0]) throw new Error(`no lobby ${code}`);
    return rows[0].id;
  });
}

/** Marks a lobby closed, as a race start or the retention sweep leaves it (its token mint answers `closed`). */
export function closeLobby(code: string): Promise<void> {
  return withDb(async (db) => {
    await db.query(`UPDATE "Lobby" SET status = 'CLOSED', "closedAt" = now() WHERE code = $1`, [
      code,
    ]);
  });
}

/**
 * A waiting lobby row the race server never opened a room for (as after its last typist left): same
 * host as `code`, a fresh code and cuid-shaped id. Returns both.
 */
export function roomlessLobbyLike(code: string): Promise<{ id: string; code: string }> {
  return withDb(async (db) => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const pick = (n: number, from: string) =>
      Array.from({ length: n }, () => from[Math.floor(Math.random() * from.length)]).join("");
    const fresh = `${pick(3, letters)}-${pick(4, "0123456789")}`;
    const id = `c${pick(24, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
    await db.query(
      `INSERT INTO "Lobby" (id, code, "hostUserId") SELECT $1, $2, "hostUserId" FROM "Lobby" WHERE code = $3`,
      [id, fresh, code],
    );
    return { id, code: fresh };
  });
}

/** The host's START button in the waiting room (#214). */
export const startButton = (page: Page) => page.getByRole("button", { name: "START", exact: true });

/** The seat view's store phase (#214: `countdown` until GO, `running` from GO). */
export const phaseOf = (page: Page) => page.locator("[data-seat-status] [data-phase]");

/**
 * A host in its own context, waiting in a fresh private room (#214, #559): the page under test then
 * visits `/race/<lobbyId>` alone, so its sockets and frames are the seat view's only. `opened` collects
 * the context for the test's cleanup; `before` runs on the host page before it loads anything.
 */
export async function hostRoom(
  browser: Browser,
  opened: BrowserContext[],
  { before }: { before?: (page: Page) => Promise<void> } = {},
) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  opened.push(context);
  const host = await context.newPage();
  await before?.(host);
  const code = await createLobby(host);
  await expect(host.getByRole("list", { name: "Typists in the room" })).toBeVisible();
  return { context, host, code, lobbyId: await lobbyIdOf(code) };
}

/**
 * `next dev` compiles a route on its first request: warm the seat view and the race server's start
 * call, so the countdown measures the race, not a compile (no-ops on a production build).
 */
export async function warmRace(page: Page, lobbyId: string) {
  await page.request.get(`/race/${lobbyId}`);
  await page.request.post("/api/internal/races", { data: {} });
}

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const raceTokens = new WeakMap<Page, { tokens: string[]; seated: boolean }>();

/**
 * Records the race tokens the page's lobby actions answer (`mintRaceToken`, the `e2e/lobby.spec.ts` C4
 * pattern: read through the route, the body is gone once Chromium cancels the request) and whether its
 * own room socket got its `welcome`. Call it before the page loads the waiting room (`hostRoom`'s
 * `before`).
 */
export async function recordRaceTokens(page: Page) {
  const record = { tokens: [] as string[], seated: false };
  const { tokens } = record;
  raceTokens.set(page, record);
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      if (String(payload).startsWith('42["welcome"')) record.seated = true;
    }),
  );
  await page.route("**/lobby/**", async (route) => {
    const r = route.request();
    if (r.method() !== "POST" || !r.headers()["next-action"]) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    tokens.push(...(body.match(JWT) ?? []));
    await route.fulfill({ response, body });
  });
}

/** The race server playwright.config.ts starts (the card worktree's port). */
const raceServerUrl = () =>
  process.env.NEXT_PUBLIC_RACE_SERVER_URL ??
  `http://localhost:${process.env.RACE_SERVER_PORT ?? 4000}`;

/**
 * The host changes the room's settings before START (#220; no lobby form sends `host:settings` until
 * #110): a Node-side socket with the host's race token emits `host:settings` and waits for `{ ok: true }`.
 * It waits for the host page's own socket to be seated first, so the host's desk stays seated when this
 * one closes (another socket of the user is still open, `presence.ts`). Pages that connect afterwards get
 * the new settings in their `welcome`.
 */
export async function setHostSettings(host: Page, patch: RaceSettingsPatch): Promise<RaceSettings> {
  const record = raceTokens.get(host);
  if (!record) throw new Error("setHostSettings: call recordRaceTokens(host) before it loads");
  await expect
    .poll(() => record.seated && record.tokens.length > 0, {
      message: "the host's race token and its seated room socket",
    })
    .toBe(true);
  const token = record.tokens.at(-1)!;
  const socket = io(raceServerUrl(), {
    auth: { v: PROTOCOL_VERSION, token },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("welcome", () => resolve());
      socket.once("connect_error", reject);
    });
    const ack = (await socket
      .timeout(5_000)
      .emitWithAck("host:settings", { v: PROTOCOL_VERSION, patch })) as
      { ok: true; settings: RaceSettings } | { ok: false; error: string };
    expect(ack, "host:settings").toMatchObject({ ok: true });
    return (ack as { settings: RaceSettings }).settings;
  } finally {
    socket.disconnect();
  }
}

/** A Node-side player of a room (#564): its desk, and its keys after GO. */
export type SimulatedPlayer = {
  readonly desk: number;
  readonly name: string;
  /** Keys this player sent so far (all correct: the next characters of the race text). */
  readonly typed: number;
  /**
   * Sends the next `count` characters of the race text as `keys` batches (at most 64 keys each),
   * stamped with the race time on the server clock. Resolves once sent, with this machine's clock
   * (`Date.now()`) at the last emit.
   */
  type(count: number): Promise<number>;
  close(): void;
};

/** An HS256 race token for a fresh player of `lobbyId`, signed like the web's mint (ADR 0009). */
function playerToken(lobbyId: string, name: string): Promise<string> {
  const secret = process.env.RACE_TOKEN_SECRET;
  if (!secret) throw new Error("simulatedPlayers: RACE_TOKEN_SECRET is not set (load the .env)");
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({
    v: PROTOCOL_VERSION,
    sub: `usr_sim_${randomUUID()}`,
    name,
    lobby: lobbyId,
    role: "player",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + RACE_TOKEN_TTL_S)
    .sign(new TextEncoder().encode(secret));
}

/**
 * `n` simulated players join the waiting room of `lobbyId` (#564; the technique of #165's 30-player
 * proof, `services/race-server/src/testing/harness.ts`): each is a Node `socket.io-client` with its own
 * race token, signed here with the local `RACE_TOKEN_SECRET` (the web app's mint stays the product
 * path). Resolves once every one is seated (its `welcome`), in join order. Each keeps the clock offset
 * of its welcome and the race of its `countdown`, so `type()` works after GO. `close()` every player
 * in the test's cleanup.
 */
export async function simulatedPlayers(
  n: number,
  lobbyId: string,
  { names }: { names?: readonly string[] } = {},
): Promise<SimulatedPlayer[]> {
  const players: SimulatedPlayer[] = [];
  // one at a time: desks follow the join order
  for (let i = 0; i < n; i++) {
    const name = names?.[i] ?? `Sim-${String(i + 1).padStart(3, "0")}`;
    const socket: Socket = io(raceServerUrl(), {
      auth: { v: PROTOCOL_VERSION, token: await playerToken(lobbyId, name) },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    let offset = 0;
    let race: Countdown["race"] | null = null;
    socket.on("countdown", (payload: Countdown) => {
      race = payload.race;
    });
    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name}: no welcome`)), scaled(10_000));
      socket.once("welcome", (w: Welcome) => {
        clearTimeout(timer);
        offset = w.serverNow - Date.now();
        resolve(w);
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    let typed = 0;
    players.push({
      desk: welcome.you!,
      name,
      get typed() {
        return typed;
      },
      async type(count) {
        if (!race) throw new Error(`${name}: no race yet`);
        const chars = charsOf(normalizeTypeable(race.text)).slice(typed, typed + count);
        let at = Date.now();
        for (let k = 0; k < chars.length; k += MAX_KEYS_PER_BATCH) {
          at = Date.now();
          const t = Math.max(0, Math.round(at + offset - race.t0));
          const batch = chars.slice(k, k + MAX_KEYS_PER_BATCH).map((key) => ({ t, key }));
          socket.emit("keys", { v: PROTOCOL_VERSION, batch });
        }
        typed += chars.length;
        return at;
      },
      close: () => void socket.disconnect(),
    });
  }
  return players;
}
