import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ROOM_STATUS_IDS,
  PROTOCOL_VERSION,
  type RoomStatus,
  type RoomStatusRequest,
} from "@fifth-copy/protocol";
import type { InternalApiClient, InternalCallResult } from "@/server/internal-api/client";
import type { RoomStatusResponse } from "@fifth-copy/protocol";
import { fakeLobbyDb } from "../testing/fake-db";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/env", () => ({
  env: { RACE_TOKEN_SECRET: "r".repeat(32), RACE_SERVER_INTERNAL_URL: "http://127.0.0.1:1" },
}));

const { listOpenLobbies, OPEN_LOBBY_MAX_AGE_MS } = await import("./list-open-lobbies");
// C6: the public, server-only entry exposes the same query.
const server = await import("../server");

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);
const SEATS = 30;

/** A stub client answering `rooms` (by lobby id) for the ids asked, or a fixed failure. */
function stubClient(
  rooms: Record<string, Omit<RoomStatus, "lobbyId">>,
  fail = false,
): InternalApiClient & { calls: RoomStatusRequest[] } {
  const calls: RoomStatusRequest[] = [];
  return {
    calls,
    openRoom: vi.fn(),
    roomStatus: vi.fn(async (request): Promise<InternalCallResult<RoomStatusResponse>> => {
      calls.push(request);
      if (fail) return { ok: false, error: "race-server-unavailable" };
      return {
        ok: true,
        data: {
          v: PROTOCOL_VERSION,
          rooms: request.lobbyIds.flatMap((lobbyId) =>
            rooms[lobbyId] ? [{ lobbyId, ...rooms[lobbyId] }] : [],
          ),
        },
      };
    }),
  };
}

const waiting = (typists: number, bots = 0) => ({
  phase: "waiting" as const,
  typists,
  bots,
  seats: SEATS,
});

describe("listOpenLobbies (#806)", () => {
  let fake: ReturnType<typeof fakeLobbyDb>;
  beforeEach(() => {
    fake = fakeLobbyDb();
    state.db = fake.db;
  });
  const seed = (
    id: string,
    minutesAgo: number,
    over: Partial<Parameters<typeof fake.seedLobby>[0]> = {},
  ) =>
    fake.seedLobby({
      id,
      code: `KGB-${id.padStart(4, "0").slice(-4)}`,
      status: "WAITING",
      hostUserId: "usr_h",
      type: "PUBLIC",
      createdAt: ago(minutesAgo),
      ...over,
    });

  it("C4: reads PUBLIC WAITING lobbies of the last 2 h, newest first, at most 50, asking the race server once", async () => {
    expect(OPEN_LOBBY_MAX_AGE_MS).toBe(2 * 3600 * 1000);
    for (let i = 1; i <= 60; i++) seed(String(i), i);
    seed("9001", 5, { type: "PRIVATE" });
    seed("9002", 5, { status: "CLOSED" });
    seed("9003", 121);
    const client = stubClient({});
    await expect(listOpenLobbies({ client, now: () => NOW })).resolves.toEqual({
      ok: true,
      lobbies: [],
    });
    expect(client.calls).toHaveLength(1);
    const [call] = client.calls;
    expect(call!.v).toBe(PROTOCOL_VERSION);
    expect(call!.lobbyIds).toHaveLength(MAX_ROOM_STATUS_IDS);
    // Newest first: 1 minute ago .. 50 minutes ago; never the private, closed or 2 h+ rows.
    expect(call!.lobbyIds).toEqual(Array.from({ length: 50 }, (_, i) => String(i + 1)));
  });

  it("C4: returns waiting rooms with a free desk as { code, typists, bots, seats }, by typists desc then newest", async () => {
    seed("1", 1); // waiting, 1 typist
    seed("2", 2); // waiting, 3 typists
    seed("3", 3); // waiting, 3 typists, older
    seed("4", 4); // countdown
    seed("5", 5); // running
    seed("6", 6); // ended
    seed("7", 7); // full: typists + bots = seats
    seed("8", 8); // no room on the race server
    const client = stubClient({
      "1": waiting(1),
      "2": waiting(3, 2),
      "3": waiting(3),
      "4": { ...waiting(2), phase: "countdown" },
      "5": { ...waiting(2), phase: "running" },
      "6": { ...waiting(2), phase: "ended" },
      "7": waiting(10, 20),
    });
    const result = await listOpenLobbies({ client, now: () => NOW });
    expect(result).toEqual({
      ok: true,
      lobbies: [
        { code: "KGB-0002", typists: 3, bots: 2, seats: SEATS },
        { code: "KGB-0003", typists: 3, bots: 0, seats: SEATS },
        { code: "KGB-0001", typists: 1, bots: 0, seats: SEATS },
      ],
    });
    // Exactly the four public fields: no lobby id, host or status.
    if (result.ok)
      for (const lobby of result.lobbies)
        expect(Object.keys(lobby).sort()).toEqual(["bots", "code", "seats", "typists"]);
  });

  it("C4: no candidate row asks nothing and lists nothing; no guest is created", async () => {
    seed("1", 200);
    const client = stubClient({});
    await expect(listOpenLobbies({ client, now: () => NOW })).resolves.toEqual({
      ok: true,
      lobbies: [],
    });
    expect(client.calls).toHaveLength(0);
    expect(fake.db.user.create).not.toHaveBeenCalled();
    expect(fake.users).toHaveLength(0);
  });

  it("C4: an answer for an id that was not asked is ignored", async () => {
    seed("1", 1);
    const client = stubClient({});
    client.roomStatus = vi.fn(async () => ({
      ok: true as const,
      data: {
        v: PROTOCOL_VERSION,
        rooms: [
          { lobbyId: "1", ...waiting(1) },
          { lobbyId: "intruder", ...waiting(1) },
        ],
      },
    }));
    await expect(listOpenLobbies({ client, now: () => NOW })).resolves.toEqual({
      ok: true,
      lobbies: [{ code: "KGB-0001", typists: 1, bots: 0, seats: SEATS }],
    });
  });

  it("C5: a race server that does not answer is race-server-unavailable, never a throw or an unchecked lobby", async () => {
    seed("1", 1);
    const client = stubClient({ "1": waiting(1) }, true);
    await expect(listOpenLobbies({ client, now: () => NOW })).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("C5: a client that rejects is race-server-unavailable too", async () => {
    seed("1", 1);
    const client = stubClient({});
    client.roomStatus = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(listOpenLobbies({ client, now: () => NOW })).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });

  it("C5: over real HTTP, an unreachable race server (default client) is race-server-unavailable", async () => {
    seed("1", 0, { createdAt: new Date() });
    await expect(server.listOpenLobbies()).resolves.toEqual({
      ok: false,
      error: "race-server-unavailable",
    });
  });
});
