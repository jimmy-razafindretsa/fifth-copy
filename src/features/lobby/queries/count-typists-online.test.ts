import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ROOM_STATUS_IDS,
  PROTOCOL_VERSION,
  type RoomStatus,
  type RoomStatusRequest,
  type RoomStatusResponse,
} from "@fifth-copy/protocol";
import type { InternalApiClient, InternalCallResult } from "@/server/internal-api/client";
import { fakeLobbyDb } from "../testing/fake-db";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/env", () => ({
  env: { RACE_TOKEN_SECRET: "r".repeat(32), RACE_SERVER_INTERNAL_URL: "http://127.0.0.1:1" },
}));

const { countTypistsOnline } = await import("./count-typists-online");
const server = await import("../server");

// #943 C21: players online = human typists in live rooms, one signed call, never throws.
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);

function stubClient(
  rooms: Record<string, Omit<RoomStatus, "lobbyId">>,
  mode: "ok" | "fail" | "throw" = "ok",
): InternalApiClient & { calls: RoomStatusRequest[] } {
  const calls: RoomStatusRequest[] = [];
  return {
    calls,
    openRoom: vi.fn(),
    setRoomType: vi.fn(),
    sharedRoom: vi.fn(),
    roomStatus: vi.fn(
      async (request: RoomStatusRequest): Promise<InternalCallResult<RoomStatusResponse>> => {
        calls.push(request);
        if (mode === "throw") throw new Error("socket hang up");
        if (mode === "fail") return { ok: false, error: "race-server-unavailable" };
        return {
          ok: true,
          data: {
            v: PROTOCOL_VERSION,
            rooms: request.lobbyIds.flatMap((lobbyId) =>
              rooms[lobbyId] ? [{ lobbyId, ...rooms[lobbyId] }] : [],
            ),
          },
        };
      },
    ),
  };
}

const room = (phase: RoomStatus["phase"], typists: number, bots = 0) => ({
  phase,
  typists,
  bots,
  seats: 30,
});

describe("countTypistsOnline (#943 C21)", () => {
  let fake: ReturnType<typeof fakeLobbyDb>;
  beforeEach(() => {
    fake = fakeLobbyDb();
    state.db = fake.db;
  });
  const seed = (id: string, minutesAgo: number, over: Record<string, unknown> = {}) =>
    fake.seedLobby({
      id,
      code: `KGB-${id.padStart(4, "0").slice(-4)}`,
      status: "WAITING",
      hostUserId: "usr_h",
      type: "PUBLIC",
      createdAt: ago(minutesAgo),
      ...over,
    });

  it("is exported by the server entry", () => {
    expect(server.countTypistsOnline).toBe(countTypistsOnline);
  });

  it("sums typists of every reported room, any phase and type; bots never count", async () => {
    seed("1", 1);
    seed("2", 2, { type: "PRIVATE" });
    seed("3", 3);
    seed("4", 4);
    seed("5", 5); // no room on the race server
    const client = stubClient({
      "1": room("waiting", 2, 5),
      "2": room("running", 3, 1),
      "3": room("countdown", 1),
      "4": room("ended", 4, 20),
    });
    await expect(countTypistsOnline({ client, now: () => NOW })).resolves.toEqual({
      ok: true,
      online: 10,
    });
  });

  it("a CLOSED lobby and one older than the room TTL are not asked; at most 50 ids in exactly one call", async () => {
    for (let i = 1; i <= 60; i++) seed(String(i), i);
    seed("9001", 5, { status: "CLOSED" });
    seed("9002", 121);
    const client = stubClient({});
    await expect(countTypistsOnline({ client, now: () => NOW })).resolves.toEqual({
      ok: true,
      online: 0,
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.v).toBe(PROTOCOL_VERSION);
    expect(client.calls[0]!.lobbyIds).toHaveLength(MAX_ROOM_STATUS_IDS);
    expect(client.calls[0]!.lobbyIds).not.toContain("9001");
    expect(client.calls[0]!.lobbyIds).not.toContain("9002");
  });

  it("no eligible lobby gives 0 without calling the race server", async () => {
    seed("1", 200);
    seed("2", 1, { status: "CLOSED" });
    const client = stubClient({});
    await expect(countTypistsOnline({ client, now: () => NOW })).resolves.toEqual({
      ok: true,
      online: 0,
    });
    expect(client.calls).toHaveLength(0);
  });

  it.each(["fail", "throw"] as const)(
    "a race server that does not answer (%s) gives { ok: false }",
    async (mode) => {
      seed("1", 1);
      await expect(
        countTypistsOnline({ client: stubClient({}, mode), now: () => NOW }),
      ).resolves.toEqual({ ok: false });
    },
  );
});
