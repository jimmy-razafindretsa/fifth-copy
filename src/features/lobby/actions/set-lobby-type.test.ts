import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { fakeLobbyDb } from "../testing/fake-db";

// Contract of #114 C3, C4: `setLobbyType` is the one writer of `Lobby.type` (ADR 0008): zod first, the
// viewer must be the row's host (never an id from the input), the lobby must be WAITING, counted by the
// `set-lobby-type` limit (ADR 0020), then one update and the page's revalidation.
const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string }>(),
  db: null as unknown,
  limited: false,
  limitCalls: [] as [string, string][],
  revalidated: [] as string[],
  /** The race server's answer to `setRoomType` (#815): a stub client, never a socket. */
  room: { ok: true, data: { v: 14, result: "ok" } } as unknown,
  roomCalls: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = state.jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string) => void state.jar.set(name, { value }),
    delete: (name: string) => void state.jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => void state.revalidated.push(path),
}));
vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_SECRET: "a".repeat(32),
    RACE_SERVER_INTERNAL_URL: "http://race.test",
    RACE_TOKEN_SECRET: "r".repeat(32),
  },
}));
vi.mock("@/server/internal-api/client", () => ({
  createInternalApiClient: () => ({
    setRoomType: async (request: unknown) => {
      state.roomCalls.push(request);
      return state.room;
    },
  }),
}));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/server/limiter", () => ({
  limit: async (action: string, subject: string) => {
    state.limitCalls.push([action, subject]);
    return { ok: !state.limited, retryAfterMs: state.limited ? 1_000 : 0 };
  },
}));

const { setLobbyType } = await import("./set-lobby-type");
const { setLobbyHost } = await import("../queries/set-lobby-host");
const { ensureGuest } = await import("@/features/identity");

describe("setLobbyType (unit, fake DB)", () => {
  let fake: ReturnType<typeof fakeLobbyDb>;
  let hostJar: Map<string, { value: string }>;
  let hostId: string;

  beforeEach(async () => {
    fake = fakeLobbyDb();
    state.db = fake.db;
    state.jar = new Map();
    state.limited = false;
    state.limitCalls = [];
    state.revalidated = [];
    state.room = { ok: true, data: { v: PROTOCOL_VERSION, result: "ok" } };
    state.roomCalls = [];
    hostId = (await ensureGuest()).id;
    hostJar = state.jar;
    fake.seedLobby({ id: "lob_open", code: "KGB-4821", status: "WAITING", hostUserId: hostId });
    fake.seedLobby({ id: "lob_closed", code: "ZRT-1093", status: "CLOSED", hostUserId: hostId });
  });

  const row = (id: string) => fake.lobbies.find((l) => l.id === id)!;

  it("C3: the host files PUBLIC: the row is updated and /lobby/[code] revalidated", async () => {
    expect(await setLobbyType({ code: "kgb 4821", type: "public" })).toEqual({ ok: true });
    expect(row("lob_open").type).toBe("PUBLIC");
    expect(state.revalidated).toEqual(["/lobby/KGB-4821"]);
    expect(state.limitCalls).toEqual([["set-lobby-type", `user:${hostId}`]]);
    expect(state.roomCalls).toEqual([
      { v: PROTOCOL_VERSION, lobbyId: "lob_open", lobbyType: "public" },
    ]);
    expect(await setLobbyType({ code: "KGB-4821", type: "private" })).toEqual({ ok: true });
    expect(row("lob_open").type).toBe("PRIVATE");
  });

  it("C4: a guest of the room gets not-host and the row is unchanged", async () => {
    state.jar = new Map();
    await ensureGuest(); // a second browser: another guest
    expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({
      ok: false,
      error: "not-host",
    });
    expect(row("lob_open").type).toBe("PRIVATE");
    expect(fake.db.lobby.update).not.toHaveBeenCalled();
    expect(state.revalidated).toEqual([]);
  });

  it("#137 C3: after the race server's host transfer, the new host files PUBLIC and the old host gets not-host", async () => {
    state.jar = new Map();
    const promoted = (await ensureGuest()).id;
    const promotedJar = state.jar;
    expect(await setLobbyHost("lob_open", promoted)).toEqual({ ok: true, changed: true });
    expect(await setLobbyHost("lob_open", promoted)).toEqual({ ok: true, changed: false });
    expect(row("lob_open").hostUserId).toBe(promoted);

    state.jar = hostJar;
    expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({
      ok: false,
      error: "not-host",
    });
    expect(row("lob_open").type).toBe("PRIVATE");
    state.jar = promotedJar;
    expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({ ok: true });
    expect(row("lob_open").type).toBe("PUBLIC");
    expect(state.limitCalls.at(-1)).toEqual(["set-lobby-type", `user:${promoted}`]);
  });

  it("C4: no viewer at all gets not-host and creates no guest", async () => {
    state.jar = new Map();
    const users = fake.users.length;
    expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({
      ok: false,
      error: "not-host",
    });
    expect(fake.users).toHaveLength(users);
    expect(fake.db.lobby.update).not.toHaveBeenCalled();
  });

  it("C3: a lobby that is no longer waiting is closed", async () => {
    state.jar = hostJar;
    expect(await setLobbyType({ code: "ZRT-1093", type: "public" })).toEqual({
      ok: false,
      error: "closed",
    });
    expect(row("lob_closed").type).toBe("PRIVATE");
  });

  it("zod first: a bad type, a user id in the input or no code is invalid, before any lookup", async () => {
    for (const input of [
      { code: "KGB-4821", type: "secret" },
      { code: "KGB-4821", type: "public", hostUserId: "usr_x", extra: 1 },
      { type: "public" },
      null,
    ]) {
      const result = await setLobbyType(input as never);
      if (input && "hostUserId" in input) {
        // an extra field is ignored by the schema: the host is the row's, never the input's
        expect(result).toEqual({ ok: true });
        continue;
      }
      expect(result).toEqual({ ok: false, error: "invalid" });
    }
    expect(row("lob_open").hostUserId).toBe(hostId);
  });

  it("#858 C3: an unknown or malformed code gets the same answer as someone else's lobby", async () => {
    const unknown = await setLobbyType({ code: "AAA-0000", type: "public" });
    const malformed = await setLobbyType({ code: "nope", type: "public" });
    state.jar = new Map();
    await ensureGuest(); // another guest: a real lobby it does not host
    const foreign = await setLobbyType({ code: "KGB-4821", type: "public" });
    expect(foreign).toEqual({ ok: false, error: "not-host" });
    expect(unknown).toEqual(foreign);
    expect(malformed).toEqual(foreign);
  });

  it("#858 C1: no viewer gets not-host without a lobby lookup or a limit call", async () => {
    state.jar = new Map();
    fake.db.lobby.findUnique.mockClear();
    expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({
      ok: false,
      error: "not-host",
    });
    expect(fake.db.lobby.findUnique).not.toHaveBeenCalled();
    expect(state.limitCalls).toEqual([]);
  });

  it("#858 C2: the limit is spent before the lookup, so a refused call looks nothing up", async () => {
    state.limited = true;
    fake.db.lobby.findUnique.mockClear();
    for (const code of ["KGB-4821", "AAA-0000"]) {
      expect(await setLobbyType({ code, type: "public" })).toEqual({
        ok: false,
        error: "rate-limited",
      });
    }
    expect(fake.db.lobby.findUnique).not.toHaveBeenCalled();
    expect(state.limitCalls).toEqual([
      ["set-lobby-type", `user:${hostId}`],
      ["set-lobby-type", `user:${hostId}`],
    ]);
  });

  it("#858 C2: a non-host's call is counted against the caller's own limit", async () => {
    state.jar = new Map();
    const other = (await ensureGuest()).id;
    await setLobbyType({ code: "KGB-4821", type: "public" });
    expect(state.limitCalls).toEqual([["set-lobby-type", `user:${other}`]]);
  });

  it("a throttled host writes nothing", async () => {
    state.limited = true;
    expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({
      ok: false,
      error: "rate-limited",
    });
    expect(row("lob_open").type).toBe("PRIVATE");
    expect(fake.db.lobby.update).not.toHaveBeenCalled();
    expect(state.roomCalls).toEqual([]);
  });

  describe("the room answers first (#815 C5)", () => {
    const refusals = [
      ["not-waiting", { ok: true, data: { v: PROTOCOL_VERSION, result: "not-waiting" } }, "closed"],
      ["no-room", { ok: true, data: { v: PROTOCOL_VERSION, result: "no-room" } }, "closed"],
      [
        "a timeout, a 5xx or an unparsable body",
        { ok: false, error: "race-server-unavailable" },
        "unavailable",
      ],
    ] as const;

    it.each(refusals)("%s: %s, Lobby.type unchanged, no revalidation", async (_, answer, error) => {
      state.room = answer;
      const users = fake.users.length;
      expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({
        ok: false,
        error,
      });
      expect(state.roomCalls).toHaveLength(1);
      expect(row("lob_open").type).toBe("PRIVATE");
      expect(fake.db.lobby.update).not.toHaveBeenCalled();
      expect(state.revalidated).toEqual([]);
      expect(fake.users).toHaveLength(users);
    });

    it("a client that throws is unavailable too, and writes nothing", async () => {
      state.room = Promise.reject(new Error("boom"));
      (state.room as Promise<unknown>).catch(() => undefined);
      expect(await setLobbyType({ code: "KGB-4821", type: "public" })).toEqual({
        ok: false,
        error: "unavailable",
      });
      expect(fake.db.lobby.update).not.toHaveBeenCalled();
    });

    it("the room is asked only after the input, host, WAITING and limit checks pass", async () => {
      await setLobbyType({ code: "KGB-4821", type: "nope" } as never);
      await setLobbyType({ code: "AAA-0000", type: "public" });
      await setLobbyType({ code: "ZRT-1093", type: "public" });
      state.limited = true;
      await setLobbyType({ code: "KGB-4821", type: "public" });
      state.limited = false;
      state.jar = new Map();
      await setLobbyType({ code: "KGB-4821", type: "public" });
      expect(state.roomCalls).toEqual([]);
    });
  });
});
