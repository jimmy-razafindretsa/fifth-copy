import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { SignJWT } from "jose";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  RACE_TOKEN_TTL_S,
  type ClientToServerEvents,
  type Member,
  type RaceSettings,
  type RaceTokenClaims,
  type ServerToClientEvents,
  type StartRaceResponse,
  type Welcome,
} from "@fifth-copy/protocol";
import { createRaceServer, type RaceServer } from "../app";
import { createFakeClock, createFakeScheduler, type FakeClock } from "../clock";
import type { WebApi } from "../persist/web-api";
import type { RaceEnded } from "../rooms/lifecycle";
import { createRedis } from "../redis/client";
import { membersKey, roomKey } from "../rooms/keys";

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
  const server = createRaceServer({
    env: { RACE_TOKEN_SECRET: SECRET, WEB_ORIGIN: "http://localhost:3000", RACE_FAST_CLOCK: "0" },
    redis: await connectRedis(redisUrl),
    clock,
    scheduler: createFakeScheduler(clock),
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
      const keys = lobbies.flatMap((id) => [roomKey(id), membersKey(id)]);
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
