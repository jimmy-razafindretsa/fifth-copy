import "dotenv/config";
import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, type Keystroke } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  raceResultsResponseSchema,
  type InternalRaceResult,
  type RaceResultsRequest,
} from "@fifth-copy/protocol";
import { startRace } from "@/features/results";
import { createPrismaClient } from "@/server/db-client";
import { internalHeaders } from "@/server/internal-api/sign";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "internal-results-route-test-secret-0123456789";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", RACE_TOKEN_SECRET: SECRET } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { POST } = await import("./route");
const { MAX_RESULTS_BODY_BYTES } = await import("@/features/results");

const nowS = () => Math.floor(Date.now() / 1000);

function post(raceId: string, rawBody: string, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://web.test/api/internal/races/${raceId}/results`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: rawBody,
    }),
    { params: Promise.resolve({ id: raceId }) },
  );
}
const signed = (body: { raceId: string } & Record<string, unknown>, raceId = body.raceId) => {
  const rawBody = JSON.stringify(body);
  return post(raceId, rawBody, internalHeaders({ rawBody, secret: SECRET, now: nowS() }));
};
const gz = (keys: unknown) => gzipSync(JSON.stringify(keys)).toString("base64");
const inflate = (data: Uint8Array) => JSON.parse(gunzipSync(data).toString());

const keysOf = (word: string, from = 0): Keystroke[] =>
  [...word].map((key, i) => ({ t: from + i * 90, key }));

describe.skipIf(!testDatabaseUrl)(
  "POST /api/internal/races/:id/results (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-race-results-";
    const CODE = "TXT-1890";
    const raceIds: string[] = [];
    let host: { id: string };
    let other: { id: string };
    let lobby: { id: string };

    const cleanup = async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds } } });
      await db.lobby.deleteMany({ where: { code: CODE } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };

    /** A Race started by #199's `startRace` for host + other + one bot. */
    const startedRace = async () => {
      const raceId = randomUUID();
      raceIds.push(raceId);
      const started = await startRace(
        {
          v: PROTOCOL_VERSION,
          raceId,
          lobbyId: lobby.id,
          hostUserId: host.id,
          settings: { ...DEFAULT_RACE_SETTINGS, language: "fr", wordCount: 50 },
          desks: [
            { desk: 1, userId: host.id, name: "Ada", isBot: false },
            { desk: 2, userId: other.id, name: "Clerk", isBot: false },
            { desk: 3, userId: null, name: "Bot-1", isBot: true },
          ],
        },
        { db },
      );
      if (!started.ok) throw new Error(started.error);
      return raceId;
    };

    const result = (over: Partial<InternalRaceResult>): InternalRaceResult => ({
      desk: 1,
      userId: host.id,
      name: "Ada",
      isBot: false,
      place: 1,
      status: "finished",
      wpm: 61.5,
      rawWpm: 64,
      cleanWpm: 61.5,
      adjustedWpm: 61.5,
      accuracy: 0.96,
      progress: 1,
      correct: 240,
      errors: 10,
      total: 250,
      durationMs: 48_210,
      finishedAtMs: 48_210,
      bonusesSent: 0,
      bonusesReceived: 0,
      bonusLog: [],
      flags: [],
      engineVersion: ENGINE_VERSION,
      trace: { encoding: "gzip+base64", data: gz([]), count: 0 },
      ...over,
    });

    const traces = { 1: keysOf("bonjour"), 2: keysOf("bon", 40) };
    const request = (raceId: string): RaceResultsRequest => ({
      v: PROTOCOL_VERSION,
      raceId,
      endedAt: 1_767_225_660_000,
      reason: "timer",
      lobbySize: 3,
      results: [
        result({ trace: { encoding: "gzip+base64", data: gz(traces[1]), count: 7 } }),
        result({
          desk: 2,
          userId: other.id,
          name: "Clerk",
          place: 2,
          status: "typing",
          progress: 0.4,
          finishedAtMs: null,
          trace: { encoding: "gzip+base64", data: gz(traces[2]), count: 3 },
        }),
        result({
          desk: 3,
          userId: null,
          name: "Bot-1",
          isBot: true,
          place: 3,
          status: "typing",
          progress: 0.2,
          finishedAtMs: null,
        }),
      ],
    });

    const rowsOf = async (raceId: string) => ({
      results: await db.raceResult.findMany({ where: { raceId }, orderBy: { desk: "asc" } }),
      keystrokes: await db.raceKeystrokes.findMany({ where: { raceId }, orderBy: { desk: "asc" } }),
      race: await db.race.findUnique({ where: { id: raceId } }),
    });

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      state.db = db;
      await cleanup();
      host = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}host` } });
      other = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}other` } });
      lobby = await db.lobby.create({ data: { code: CODE, hostUserId: host.id } });
    });
    beforeEach(() => {
      state.db = db;
      vi.restoreAllMocks();
    });
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("C4: 2 humans + 1 bot -> 3 results, 2 keystroke rows, the race's end; a repeat changes nothing", async () => {
      const raceId = await startedRace();
      const body = request(raceId);
      const res = await signed(body);
      expect(res.status).toBe(200);
      const answer = raceResultsResponseSchema.parse(await res.json());
      expect(answer).toEqual({ v: PROTOCOL_VERSION, raceId, persisted: [1, 2, 3] });

      const rows = await rowsOf(raceId);
      expect(rows.results).toHaveLength(3);
      expect(rows.results.map((r) => [r.desk, r.userId, r.isBot, r.place, r.status])).toEqual([
        [1, host.id, false, 1, "FINISHED"],
        [2, other.id, false, 2, "TIMED_OUT"],
        [3, null, true, 3, "TIMED_OUT"],
      ]);
      expect(rows.results[0]).toMatchObject({
        wpm: 61.5,
        rawWpm: 64,
        cleanWpm: 61.5,
        adjustedWpm: 61.5,
        accuracy: 0.96,
        correct: 240,
        errors: 10,
        total: 250,
        durationMs: 48_210,
        finishedAtMs: 48_210,
        bonusLog: [],
        engineVersion: ENGINE_VERSION,
      });
      expect(rows.keystrokes.map((k) => [k.desk, k.userId, k.count])).toEqual([
        [1, host.id, 7],
        [2, other.id, 3],
      ]);
      expect(inflate(rows.keystrokes[0]!.data)).toEqual(traces[1]);
      expect(inflate(rows.keystrokes[1]!.data)).toEqual(traces[2]);
      expect(rows.race?.endedAt?.getTime()).toBe(body.endedAt);
      expect(rows.race?.endReason).toBe("TIMER");
      expect(rows.race?.lobbySize).toBe(3);

      const again = await signed({ ...body, endedAt: body.endedAt + 5_000 });
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(answer);
      expect(await rowsOf(raceId)).toEqual(rows);
    });

    it("C4: an unknown race is 404; a count that does not match its trace is 400 and writes nothing", async () => {
      const missing = randomUUID();
      const res = await signed(request(missing));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "not-found" });

      const raceId = await startedRace();
      const body = request(raceId);
      body.results[1]!.trace.count = 4;
      const bad = await signed(body);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ v: PROTOCOL_VERSION, error: "bad-body" });
      const rows = await rowsOf(raceId);
      expect(rows.results).toHaveLength(0);
      expect(rows.keystrokes).toHaveLength(0);
      expect(rows.race?.endedAt).toBeNull();
    });

    it("refuses a path id other than the body's, a gzip bomb, duplicate desks and a bot with a user", async () => {
      const raceId = await startedRace();
      const bomb = gzipSync(Buffer.alloc(32 * 1024 * 1024, 0x20)).toString("base64");
      const cases: RaceResultsRequest[] = [
        (() => {
          const b = request(raceId);
          b.results[0]!.trace = { encoding: "gzip+base64", data: bomb, count: 7 };
          return b;
        })(),
        { ...request(raceId), results: [request(raceId).results[0]!, request(raceId).results[0]!] },
        (() => {
          const b = request(raceId);
          b.results[2]!.userId = host.id;
          return b;
        })(),
      ];
      for (const body of cases) {
        const res = await signed(body);
        expect(res.status).toBe(400);
      }
      const elsewhere = await signed(request(raceId), randomUUID());
      expect(elsewhere.status).toBe(400);
      expect((await rowsOf(raceId)).results).toHaveLength(0);
    });

    it("C5: a failure on the keystrokes write leaves no RaceResult row (one transaction)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const raceId = await startedRace();
      const failing = new Proxy(db, {
        get(target, key) {
          if (key !== "$transaction") return Reflect.get(target, key);
          return (fn: (tx: unknown) => Promise<unknown>) =>
            target.$transaction((tx) =>
              fn(
                new Proxy(tx, {
                  get(t, k) {
                    if (k !== "raceKeystrokes") return Reflect.get(t, k);
                    return {
                      upsert: vi.fn(async () => {
                        throw new Error("keystrokes write failed: secret detail");
                      }),
                    };
                  },
                }),
              ),
            );
        },
      });
      state.db = failing;
      const res = await signed(request(raceId));
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("");
      for (const call of vi.mocked(console.error).mock.calls) {
        expect(JSON.stringify(call)).not.toContain("secret detail");
      }
      state.db = db;
      const rows = await rowsOf(raceId);
      expect(rows.results).toHaveLength(0);
      expect(rows.keystrokes).toHaveLength(0);
      expect(rows.race?.endedAt).toBeNull();
    });

    it("a user deleted mid-race is acknowledged without a row; the others are stored", async () => {
      const gone = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}gone` } });
      const raceId = await startedRace();
      const body = request(raceId);
      body.results[1]!.userId = gone.id;
      await db.user.delete({ where: { id: gone.id } });
      const res = await signed(body);
      expect(res.status).toBe(200);
      expect((await res.json()).persisted).toEqual([1, 2, 3]);
      const rows = await rowsOf(raceId);
      expect(rows.results.map((r) => r.desk)).toEqual([1, 3]);
      expect(rows.keystrokes.map((k) => k.desk)).toEqual([1]);
    });

    it("the route cap: a body over 64 KiB is read; one over MAX_RESULTS_BODY_BYTES is bad-body", async () => {
      const raceId = await startedRace();
      const padded = { ...request(raceId), pad: "x".repeat(200 * 1024) };
      expect((await signed(padded)).status).toBe(200);
      const huge = { ...request(raceId), pad: "x".repeat(MAX_RESULTS_BODY_BYTES) };
      const res = await signed(huge);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "bad-body" });
    });
  },
);
