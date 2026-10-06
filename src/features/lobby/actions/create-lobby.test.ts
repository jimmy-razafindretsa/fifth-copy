import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openRoomRequestSchema, PROTOCOL_VERSION, ROOM_CODE_RE } from "@fifth-copy/protocol";
import { createPrismaClient } from "@/server/db-client";
import {
  startRaceServerStub,
  unreachableUrl,
  type RaceServerStub,
} from "@/server/internal-api/stub-server";
import { Prisma } from "@/generated/prisma/client";
import { fakeLobbyDb } from "../testing/fake-db";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// One browser cookie jar shared by every "request"; db and race-server URL swappable per test.
const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string }>(),
  db: null as unknown,
  raceUrl: "http://127.0.0.1:1",
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
}));
vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_SECRET: "a".repeat(32),
    RACE_TOKEN_SECRET: "r".repeat(32),
    get RACE_SERVER_INTERNAL_URL() {
      return state.raceUrl;
    },
    NEXT_PUBLIC_RACE_SERVER_URL: "http://race.test:4000",
  },
}));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { createLobby } = await import("../index");
const { getViewer } = await import("@/features/identity");

const opened = { v: PROTOCOL_VERSION, roomId: "room", phase: "waiting", created: true };

describe("createLobby", () => {
  let stub: RaceServerStub;

  beforeAll(async () => {
    stub = await startRaceServerStub();
  });
  beforeEach(() => {
    state.jar.clear();
    state.raceUrl = stub.url;
    stub.requests.length = 0;
    stub.reply(() => ({ status: 200, body: opened }));
  });
  afterAll(() => stub.close());

  describe("unit, fake DB", () => {
    let fake: ReturnType<typeof fakeLobbyDb>;
    beforeEach(() => {
      fake = fakeLobbyDb();
      state.db = fake.db;
    });

    it("C1: retries on a unique violation and succeeds on the second draw", async () => {
      fake.db.lobby.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
      const result = await createLobby();
      expect(fake.db.lobby.create).toHaveBeenCalledTimes(2);
      const second = fake.db.lobby.create.mock.calls[1]![0].data.code;
      expect(result).toEqual({ ok: true, code: second });
      expect(second).toMatch(ROOM_CODE_RE);
      expect(fake.lobbies).toHaveLength(1);
    });

    it("C2: hosts the lobby by the guest it creates, and opens the room with that lobby", async () => {
      const result = await createLobby();
      expect(fake.db.user.create).toHaveBeenCalledTimes(1);
      const [lobby] = fake.lobbies;
      expect(result).toEqual({ ok: true, code: lobby!.code });
      expect(lobby!.hostUserId).toBe(fake.users[0]!.id);
      expect(stub.requests).toHaveLength(1);
      expect(JSON.parse(stub.requests[0]!.body)).toEqual({
        v: PROTOCOL_VERSION,
        lobbyId: lobby!.id,
        code: lobby!.code,
        hostUserId: fake.users[0]!.id,
      });
    });

    it("C4: a 500 deletes the lobby row and returns race-server-unavailable", async () => {
      stub.reply(() => ({ status: 500 }));
      await expect(createLobby()).resolves.toEqual({ ok: false, error: "race-server-unavailable" });
      expect(fake.db.lobby.delete).toHaveBeenCalledTimes(1);
      expect(fake.lobbies).toHaveLength(0);
    });

    it("draws room codes from a CSPRNG, never Math.random", async () => {
      await createLobby(); // the first call creates the guest (its name draw may use Math.random)
      const random = vi.spyOn(Math, "random");
      try {
        await expect(createLobby()).resolves.toMatchObject({ ok: true });
        expect(random).not.toHaveBeenCalled();
      } finally {
        random.mockRestore();
      }
    });

    it("propagates non-collision DB errors", async () => {
      fake.db.lobby.create.mockRejectedValueOnce(new Error("connection lost"));
      await expect(createLobby()).rejects.toThrow("connection lost");
      expect(stub.requests).toHaveLength(0);
    });
  });

  describe.skipIf(!testDatabaseUrl)(
    "integration, test DB + race-server stub (needs TEST_DATABASE_URL)",
    { timeout: 15_000 },
    () => {
      let db: ReturnType<typeof createPrismaClient>;
      const createdUsers: string[] = [];
      let userCreates = 0;

      // Counts User inserts made by this file only (other files share the test DB in parallel).
      const counting = (client: typeof db) =>
        new Proxy(client, {
          get: (target, key) => {
            const value = target[key as keyof typeof target];
            if (key !== "user") return value;
            return new Proxy(value as object, {
              get: (delegate, method) => {
                const fn = (delegate as Record<PropertyKey, unknown>)[method];
                if (method !== "create" || typeof fn !== "function") return fn;
                return (...args: unknown[]) => {
                  userCreates++;
                  return fn.apply(delegate, args);
                };
              },
            });
          },
        });

      const guestId = async () => {
        const viewer = await getViewer();
        if (viewer) createdUsers.push(viewer.id);
        return viewer?.id;
      };

      beforeAll(async () => {
        db = createPrismaClient(testDatabaseUrl!);
        await db.$connect();
      }, 30_000);
      beforeEach(() => {
        userCreates = 0;
        state.db = counting(db);
      });
      afterAll(async () => {
        // Deleting the host users cascades to their lobbies.
        await db.user.deleteMany({ where: { id: { in: createdUsers } } });
        await db.$disconnect();
      });

      it("C2: without a guest cookie creates one User and one PRIVATE WAITING Lobby it hosts, POSTs once", async () => {
        const result = await createLobby();
        const hostUserId = await guestId();
        expect(userCreates).toBe(1);
        expect(hostUserId).toBeDefined();

        const lobbies = await db.lobby.findMany({ where: { hostUserId } });
        expect(lobbies).toHaveLength(1);
        expect(lobbies[0]).toMatchObject({ type: "PRIVATE", status: "WAITING", hostUserId });
        expect(result).toEqual({ ok: true, code: lobbies[0]!.code });

        expect(stub.requests).toHaveLength(1);
        expect(stub.requests[0]).toMatchObject({ method: "POST", url: "/internal/rooms" });
        expect(openRoomRequestSchema.parse(JSON.parse(stub.requests[0]!.body))).toEqual({
          v: PROTOCOL_VERSION,
          lobbyId: lobbies[0]!.id,
          code: lobbies[0]!.code,
          hostUserId,
        });
      });

      it.each([
        ["answers 500", async () => (stub.reply(() => ({ status: 500 })), stub.url)],
        ["is unreachable", unreachableUrl],
      ])(
        "C4: when the race server %s, returns race-server-unavailable within 3 s and leaves no WAITING lobby",
        async (_label, url) => {
          state.raceUrl = await url();
          const started = Date.now();
          await expect(createLobby()).resolves.toEqual({
            ok: false,
            error: "race-server-unavailable",
          });
          expect(Date.now() - started).toBeLessThan(3_000);
          const hostUserId = await guestId();
          expect(await db.lobby.count({ where: { hostUserId, status: "WAITING" } })).toBe(0);
        },
      );
    },
  );
});
