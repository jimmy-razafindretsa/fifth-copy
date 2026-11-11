import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalApiClient } from "@/server/internal-api/client";

// #880 C1, C2: `shareLobby(viewer, owner)` over a stub race server client and a fake db. The fake
// `raceResult.findFirst` evaluates the one where-shape `racedTogether` sends, so the 24 h boundary,
// the null `endedAt` and the one-race rule are checked against rows, not against the query text.
// The real SQL is checked by src/features/results/queries/raced-together.test.ts (TEST_DATABASE_URL).

type Race = { id: string; endedAt: Date | null };
type Result = { raceId: string; userId: string | null };
type Where = {
  userId: string;
  race: { endedAt: { gt: Date }; results: { some: { userId: string } } };
};

const state = vi.hoisted(() => ({
  races: [] as Race[],
  results: [] as Result[],
  dbThrows: false,
}));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused",
    RACE_SERVER_INTERNAL_URL: "http://race.invalid",
    RACE_TOKEN_SECRET: "s".repeat(32),
  },
}));
vi.mock("@/server/db", () => ({
  db: {
    raceResult: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => {
        if (state.dbThrows) throw new Error("connection refused");
        const hit = state.results.find((r) => {
          if (r.userId !== where.userId) return false;
          const race = state.races.find((x) => x.id === r.raceId);
          if (!race?.endedAt || !(race.endedAt > where.race.endedAt.gt)) return false;
          const other = where.race.results.some.userId;
          return state.results.some((o) => o.raceId === race.id && o.userId === other);
        });
        return hit ? { id: `${hit.raceId}:${hit.userId}` } : null;
      }),
    },
  },
}));

const { shareLobby } = await import("@/features/lobby/server");
const { db } = await import("@/server/db");

const NOW = Date.parse("2026-11-11T12:00:00Z");
const HOUR = 3_600_000;
const now = () => NOW;

type SharedAnswer = Awaited<ReturnType<InternalApiClient["sharedRoom"]>>;
function client(answer: SharedAnswer | (() => Promise<SharedAnswer>)) {
  const sharedRoom = vi.fn(typeof answer === "function" ? answer : async () => answer);
  return { client: { sharedRoom } as unknown as InternalApiClient, sharedRoom };
}
const shared = (value: boolean): SharedAnswer => ({ ok: true, data: { v: 1, shared: value } });
const DOWN: SharedAnswer = { ok: false, error: "race-server-unavailable" };

/** A race that ended `hoursAgo` before NOW (null: never ended) with these user ids (null: a bot). */
function race(id: string, hoursAgo: number | null, userIds: (string | null)[]) {
  state.races.push({ id, endedAt: hoursAgo === null ? null : new Date(NOW - hoursAgo * HOUR) });
  for (const userId of userIds) state.results.push({ raceId: id, userId });
}

describe("shareLobby (#880)", () => {
  beforeEach(() => {
    state.races = [];
    state.results = [];
    state.dbThrows = false;
    vi.mocked(db.raceResult.findFirst).mockClear();
  });

  describe("C1 (a) live room", () => {
    it("is true when the race server answers shared: true, asking for the pair", async () => {
      const { client: c, sharedRoom } = client(shared(true));
      expect(await shareLobby("bob", "alice", { client: c, now })).toBe(true);
      expect(sharedRoom).toHaveBeenCalledTimes(1);
      const request = sharedRoom.mock.calls[0]![0];
      expect(request.userIds).toEqual(["bob", "alice"]);
      expect(typeof request.v).toBe("number");
    });

    it("is false when the race server answers shared: false and no race was shared", async () => {
      const { client: c } = client(shared(false));
      expect(await shareLobby("bob", "alice", { client: c, now })).toBe(false);
    });
  });

  describe("C1 (b) a race together in the last 24 h", () => {
    it("is true when both have a RaceResult on one race that ended 1 h ago", async () => {
      race("r1", 1, ["alice", "bob", null]);
      const { client: c } = client(shared(false));
      expect(await shareLobby("bob", "alice", { client: c, now })).toBe(true);
    });

    it("is true just inside the window (24 h less 1 ms)", async () => {
      race("r1", 24 - 1 / HOUR, ["alice", "bob"]);
      expect(await shareLobby("bob", "alice", { client: client(shared(false)).client, now })).toBe(
        true,
      );
    });

    it.each([
      ["exactly 24 h ago", 24],
      ["25 h ago", 25],
      ["a week ago", 24 * 7],
    ])("is false for a race that ended %s", async (_l, hoursAgo) => {
      race("r1", hoursAgo, ["alice", "bob"]);
      expect(await shareLobby("bob", "alice", { client: client(shared(false)).client, now })).toBe(
        false,
      );
    });

    it("is false for a race that never ended (endedAt null)", async () => {
      race("r1", null, ["alice", "bob"]);
      expect(await shareLobby("bob", "alice", { client: client(shared(false)).client, now })).toBe(
        false,
      );
    });

    it("is false when each raced recently but in different races", async () => {
      race("r1", 1, ["alice", null]);
      race("r2", 1, ["bob", null]);
      expect(await shareLobby("bob", "alice", { client: client(shared(false)).client, now })).toBe(
        false,
      );
    });

    it("uses the injected now: the same race is shared at NOW, not 2 h later", async () => {
      race("r1", 23, ["alice", "bob"]);
      const c = client(shared(false)).client;
      expect(await shareLobby("bob", "alice", { client: c, now })).toBe(true);
      expect(await shareLobby("bob", "alice", { client: c, now: () => NOW + 2 * HOUR })).toBe(
        false,
      );
    });
  });

  describe("C2 fail closed, never throws", () => {
    it.each([
      ["{ ok: false }", () => Promise.resolve(DOWN)],
      ["a throw", () => Promise.reject(new Error("boom"))],
      [
        "a timeout (never settles past the client's own timeout)",
        () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
      ],
    ])("race server %s: path (a) is false, path (b) still decides", async (_l, answer) => {
      const c = client(answer as () => Promise<SharedAnswer>).client;
      expect(await shareLobby("bob", "alice", { client: c, now })).toBe(false);
      race("r1", 1, ["alice", "bob"]);
      expect(await shareLobby("bob", "alice", { client: c, now })).toBe(true);
    });

    it("a synchronous throw from the client is false, not a throw", async () => {
      const c = {
        sharedRoom: () => {
          throw new Error("sync");
        },
      } as unknown as InternalApiClient;
      await expect(shareLobby("bob", "alice", { client: c, now })).resolves.toBe(false);
    });

    it("the Postgres read throwing makes the answer false", async () => {
      state.dbThrows = true;
      await expect(
        shareLobby("bob", "alice", { client: client(shared(false)).client, now }),
      ).resolves.toBe(false);
    });

    it("the Postgres read throwing and the race server down: false, no throw", async () => {
      state.dbThrows = true;
      const c = client(() => Promise.reject(new Error("down"))).client;
      await expect(shareLobby("bob", "alice", { client: c, now })).resolves.toBe(false);
    });

    it("the same id twice is not a lobby mate (the owner rule is the route's) and asks no one", async () => {
      const { client: c, sharedRoom } = client(shared(true));
      expect(await shareLobby("alice", "alice", { client: c, now })).toBe(false);
      expect(sharedRoom).not.toHaveBeenCalled();
      expect(db.raceResult.findFirst).not.toHaveBeenCalled();
    });
  });
});
