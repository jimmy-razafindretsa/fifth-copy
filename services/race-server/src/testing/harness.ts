import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { SignJWT } from "jose";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import type { Keystroke } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  RACE_TOKEN_TTL_S,
  type ClientToServerEvents,
  type Ended,
  type Member,
  type RaceEvent,
  type RaceSettings,
  type Rejected,
  type Snapshot,
  type RaceTokenClaims,
  type ServerToClientEvents,
  type StartRaceResponse,
  type Welcome,
} from "@fifth-copy/protocol";
import { createRaceServer, type RaceServer } from "../app";
import { createFakeClock, createFakeScheduler, type FakeClock, type FakeScheduler } from "../clock";
import type { WebApi } from "../persist/web-api";
import type { RaceEnded } from "../rooms/lifecycle";
import { createRedis } from "../redis/client";
import { desksKey, membersKey, roomKey } from "../rooms/keys";

// Test-only harness for the race server's integration tests (real Redis, ARCHITECTURE testing table).
// Fails, never skips, without Redis. Deletes only the keys of lobbies it created (shared db index).

export const SECRET = "race-server-test-secret-0123456789abcdef";
/** The `hostUserId` of every room `openRoom` opens: a token with this `sub` is the host's. */
export const HOST_SUB = "usr_host";
export type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

/**
 * `url` is the REDIS_URL the calling test file read from its environment (env access stays in test
 * files and env.ts).
 */
export async function connectRedis(url: string | undefined): Promise<Redis> {
  if (!url) throw new Error("REDIS_URL is not set: load the worktree .env (set -a; . ./.env)");
  const redis = createRedis(url);
  try {
    await redis.connect();
  } catch (err) {
    redis.disconnect();
    throw new Error(`Redis unreachable at REDIS_URL: ${(err as Error).message}`);
  }
  return redis;
}

/** The text every start of the default fake `WebApi` gets. */
export const FIXTURE_TEXT = {
  content: "Le formulaire est en triple exemplaire.",
  language: "fr",
  wordCount: 6,
  sourceRef: null,
} satisfies StartRaceResponse["text"];

/** A `WebApi` that accepts every start with `FIXTURE_TEXT`; `calls` records each request. */
export function fixtureWebApi(clock: { now(): number }) {
  const calls: Parameters<WebApi["startRace"]>[0][] = [];
  const api: WebApi = {
    startRace: async (request) => {
      calls.push(request);
      return {
        v: PROTOCOL_VERSION,
        raceId: request.raceId,
        text: FIXTURE_TEXT,
        settings: request.settings,
        startedAt: clock.now(),
      };
    },
  };
  return { api, calls };
}

export type Booted = {
  server: RaceServer;
  url: string;
  clock: FakeClock;
  /** Drives the server's timers through `clock.advance`; `armed()` counts pending ones. */
  scheduler: FakeScheduler;
  /** Opens a room for a fresh lobby id (cleaned up by `stop`), with the default settings unless given. */
  openRoom(code?: string, settings?: RaceSettings): Promise<string>;
  /** A fresh lobby id with no room (cleaned up by `stop`). */
  lobby(): string;
  token(claims: Partial<RaceTokenClaims> & { lobby: string }, key?: string): Promise<string>;
  connect(auth: unknown): Client;
  /** Disconnects the clients, closes the server and deletes this boot's keys. */
  stop(): Promise<void>;
};

/**
 * Boots the server on port 0 with a fake clock whose `advance` also fires the fake scheduler's
 * timers. `webApi` defaults to `fixtureWebApi`.
 */
export async function boot(
  redisUrl: string | undefined,
  options: { webApi?: WebApi; onRaceEnded?: (ended: RaceEnded) => void } = {},
): Promise<Booted> {
  const clock = createFakeClock(Date.now());
  const scheduler = createFakeScheduler(clock);
  const server = createRaceServer({
    env: { RACE_TOKEN_SECRET: SECRET, WEB_ORIGIN: "http://localhost:3000", RACE_FAST_CLOCK: "0" },
    redis: await connectRedis(redisUrl),
    clock,
    scheduler,
    webApi: options.webApi ?? fixtureWebApi(clock).api,
    onRaceEnded: options.onRaceEnded,
  });
  const port = await server.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const lobbies: string[] = [];
  const clients: Client[] = [];

  const lobby = () => {
    const id = `lob_${randomUUID()}`;
    lobbies.push(id);
    return id;
  };

  return {
    server,
    url,
    clock,
    scheduler,
    lobby,
    async openRoom(code = "KGB-4821", settings = DEFAULT_RACE_SETTINGS) {
      const lobbyId = lobby();
      await server.registry.open({ lobbyId, code, hostUserId: HOST_SUB, settings });
      return lobbyId;
    },
    token(claims, key = SECRET) {
      const iat = Math.floor(clock.now() / 1000);
      return new SignJWT({
        v: PROTOCOL_VERSION,
        sub: `usr_${randomUUID()}`,
        name: "Ada",
        role: "player",
        ...claims,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(iat)
        .setExpirationTime(iat + RACE_TOKEN_TTL_S)
        .sign(new TextEncoder().encode(key));
    },
    connect(auth) {
      const client: Client = connectClient(url, {
        auth: auth as Record<string, unknown>,
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
      });
      clients.push(client);
      return client;
    },
    async stop() {
      for (const c of clients) c.disconnect();
      await server.close();
      const cleanup = await connectRedis(redisUrl);
      const keys = lobbies.flatMap((id) => [roomKey(id), membersKey(id), desksKey(id)]);
      for (const id of lobbies) keys.push(...(await cleanup.keys(`${roomKey(id)}:trace:*`)));
      if (keys.length) await cleanup.del(...keys);
      cleanup.disconnect();
    },
  };
}

/** Records every `welcome`, the latest `roster` and every `settings` broadcast a client received. */
export function track(client: Client) {
  const seen: {
    welcome?: Welcome;
    roster?: Member[];
    rosters: number;
    settings: RaceSettings[];
  } = { rosters: 0, settings: [] };
  client.on("welcome", (w) => (seen.welcome = w));
  client.on("settings", (s) => void seen.settings.push(s.settings));
  client.on("roster", (r) => {
    seen.roster = r.members;
    seen.rosters += 1;
  });
  return seen;
}

export function connectError(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    client.once("connect_error", (err) => resolve(err.message));
    client.once("connect", () => reject(new Error("unexpectedly connected")));
  });
}

/** Polls `check` every 20 ms until it is true or `ms` elapses. */
export async function until(check: () => boolean, ms: number, what = "condition"): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A `WebApi` that starts every race on `content` (one word, e.g. "bonjour"). */
export function textWebApi(content: string): WebApi {
  return {
    startRace: async (request) => ({
      v: PROTOCOL_VERSION,
      raceId: request.raceId,
      text: { content, language: "fr", wordCount: content.split(" ").length, sourceRef: null },
      settings: request.settings,
      startedAt: 0,
    }),
  };
}

/** What a racer's client received during a race (#173). */
export type RaceSeen = ReturnType<typeof track> & {
  snapshots: Snapshot[];
  events: RaceEvent[];
  ended: Ended[];
  rejected: Rejected[];
};

export function watchRace(client: Client): RaceSeen {
  const seen: RaceSeen = Object.assign(track(client), {
    snapshots: [] as Snapshot[],
    events: [] as RaceEvent[],
    ended: [] as Ended[],
    rejected: [] as Rejected[],
  });
  client.on("snapshot", (s) => void seen.snapshots.push(s));
  client.on("event", (e) => void seen.events.push(e));
  client.on("ended", (e) => void seen.ended.push(e));
  client.on("rejected", (r) => void seen.rejected.push(r));
  return seen;
}

export type Racer = { client: Client; seen: RaceSeen; desk: number };

/**
 * Boots a server, seats the host (desk 1) and `players - 1` players (desks 2..), starts a race on
 * `text` and, unless `go` is false, advances the fake clock to GO and waits for the desks' runtime.
 */
export async function startedRace(
  redisUrl: string | undefined,
  {
    players = 2,
    text = "bonjour",
    settings = DEFAULT_RACE_SETTINGS,
    go = true,
    onRaceEnded,
  }: {
    players?: number;
    text?: string;
    settings?: RaceSettings;
    go?: boolean;
    onRaceEnded?: (ended: RaceEnded) => void;
  } = {},
) {
  const booted = await boot(redisUrl, { webApi: textWebApi(text), onRaceEnded });
  const lobby = await booted.openRoom("KGB-4821", settings);
  const racers: Racer[] = [];
  for (let i = 0; i < players; i++) {
    const sub = i === 0 ? HOST_SUB : `usr_p${i}`;
    const role = i === 0 ? "host" : "player";
    const client = booted.connect({
      v: PROTOCOL_VERSION,
      token: await booted.token({ lobby, sub, name: `Clerk ${i}`, role }),
    });
    const seen = watchRace(client);
    await until(() => !!seen.welcome, 3_000, `welcome ${i}`);
    racers.push({ client, seen, desk: seen.welcome!.you! });
  }
  await until(() => racers.every((r) => r.seen.roster?.length === players), 3_000, "seated");
  const ack = await racers[0]!.client.timeout(2_000).emitWithAck("host:start", {
    v: PROTOCOL_VERSION,
  });
  if (!ack.ok) throw new Error(`start failed: ${ack.error}`);
  const t0 = booted.clock.now() + 3_000;
  if (go) await reachGo(booted, lobby, t0);
  return { booted, lobby, racers, t0 };
}

/** Advances the fake clock to GO and waits until the room's desks run. */
export async function reachGo(booted: Booted, lobby: string, t0: number) {
  booted.clock.advance(t0 - booted.clock.now());
  await until(() => booted.server.desks.get(lobby)?.phase === "running", 3_000, "GO");
}

/** Sends `keys` with one keystroke per character of `chars` at `t` ms since GO (+ `step` each). */
export function typeKeys(client: Client, chars: string, t: number, step = 0) {
  const batch: Keystroke[] = [...chars].map((key, i) => ({ t: t + i * step, key }));
  client.emit("keys", { v: PROTOCOL_VERSION, batch });
}
