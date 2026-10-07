import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTypeable, wordCount } from "@fifth-copy/engine";
import {
  DEFAULT_RACE_SETTINGS,
  PROTOCOL_VERSION,
  startRaceResponseSchema,
  type StartRaceRequest,
} from "@fifth-copy/protocol";
import { createPrismaClient } from "@/server/db-client";
import { internalHeaders } from "@/server/internal-api/sign";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "internal-races-route-test-secret-0123456789";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", RACE_TOKEN_SECRET: SECRET } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { POST } = await import("./route");

const nowS = () => Math.floor(Date.now() / 1000);

function post(rawBody: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://web.test/api/internal/races", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: rawBody,
    }),
  );
}
const signed = (body: unknown, now = nowS()) => {
  const rawBody = JSON.stringify(body);
  return post(rawBody, internalHeaders({ rawBody, secret: SECRET, now }));
};

describe.skipIf(!testDatabaseUrl)(
  "POST /api/internal/races (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-start-race-";
    const CODES = ["TXT-1990", "TXT-1991"];
    const raceIds: string[] = [];
    let host: { id: string };
    let other: { id: string };
    let lobby: { id: string };
    let closed: { id: string };

    const cleanup = async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds } } });
      await db.lobby.deleteMany({ where: { code: { in: CODES } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const rows = () => db.race.count({ where: { id: { in: raceIds } } });

    const request = (over: Partial<StartRaceRequest> = {}): StartRaceRequest => {
      const raceId = randomUUID();
      raceIds.push(raceId);
      return {
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
        ...over,
      };
    };

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      state.db = db;
      await cleanup();
      host = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}host` } });
      other = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}other` } });
      lobby = await db.lobby.create({ data: { code: CODES[0]!, hostUserId: host.id } });
      closed = await db.lobby.create({
        data: { code: CODES[1]!, hostUserId: host.id, status: "CLOSED" },
      });
    });
    beforeEach(async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
    });
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("C1: creates one Race with the generated text and settings, idempotent on raceId", async () => {
      const body = request();
      const res = await signed(body);
      expect(res.status).toBe(200);
      const answer = startRaceResponseSchema.parse(await res.json());
      expect(answer.raceId).toBe(body.raceId);
      expect(answer.settings).toEqual(body.settings);
      expect(answer.text.language).toBe("fr");
      expect(answer.text.wordCount).toBe(body.settings.wordCount);
      expect(wordCount(answer.text.content)).toBe(body.settings.wordCount);
      expect(answer.text.content).toBe(normalizeTypeable(answer.text.content));

      const stored = await db.race.findMany({ where: { id: body.raceId } });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        lobbyId: lobby.id,
        textContent: answer.text.content,
        textLanguage: "FR",
        textWordCount: 50,
        textSourceRef: answer.text.sourceRef,
        settings: body.settings,
        lobbySize: 3,
        protocolVersion: PROTOCOL_VERSION,
      });
      expect(stored[0]!.startedAt.getTime()).toBe(answer.startedAt);

      const again = await signed(body);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(answer);
      expect(await db.race.count({ where: { id: body.raceId } })).toBe(1);
    });

    it("C1: two concurrent starts with the same raceId store one row and answer the same text", async () => {
      const body = request();
      const [a, b] = await Promise.all([signed(body), signed(body)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await a.json()).toEqual(await b.json());
      expect(await db.race.count({ where: { id: body.raceId } })).toBe(1);
    });

    it("C2: refusals answer the protocol error and create no Race row", async () => {
      const valid = request();
      const raw = JSON.stringify(valid);
      const cases: [string, () => Promise<Response>, number, string][] = [
        ["unsigned", () => post(raw), 401, "stale-timestamp"],
        [
          "no signature",
          () => post(raw, { "x-fc-timestamp": String(nowS()) }),
          401,
          "bad-signature",
        ],
        ["stale 301 s", () => signed(valid, nowS() - 301), 401, "stale-timestamp"],
        [
          "tampered after signing",
          () =>
            post(
              raw.replace('"wordCount":50', '"wordCount":51'),
              internalHeaders({ rawBody: raw, secret: SECRET, now: nowS() }),
            ),
          401,
          "bad-signature",
        ],
        ["unknown lobby", () => signed(request({ lobbyId: "lob_missing" })), 404, "not-found"],
        ["closed lobby", () => signed(request({ lobbyId: closed.id })), 404, "not-found"],
        ["other host", () => signed(request({ hostUserId: other.id })), 409, "conflict"],
        ["previous v", () => signed({ ...request(), v: 3 }), 426, "version"],
        ["schema", () => signed({ ...request(), desks: [] }), 400, "bad-body"],
        [
          "over 64 KiB",
          () => signed({ ...request(), pad: "x".repeat(64 * 1024) }),
          400,
          "bad-body",
        ],
      ];
      for (const [name, send, status, error] of cases) {
        const res = await send();
        expect({ name, status: res.status }).toEqual({ name, status });
        expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error });
      }
      expect(await rows()).toBe(0);
    });

    it("ids with control characters are bad-body and create no row", async () => {
      const cases = [
        request({ lobbyId: "lob\u0000x" }),
        request({ hostUserId: "usr\u0007" }),
        request({ desks: [{ desk: 1, userId: "usr\u001b[2J", name: "Ada", isBot: false }] }),
      ];
      for (const body of cases) {
        const res = await signed(body);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "bad-body" });
      }
      expect(await rows()).toBe(0);
    });

    it("an unexpected failure answers a bare 500 with no detail", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const real = state.db;
      state.db = new Proxy(
        {},
        {
          get: () => ({
            findUnique: async () => {
              throw new Error("db exploded: secret detail");
            },
          }),
        },
      );
      try {
        const res = await signed(request());
        expect(res.status).toBe(500);
        expect(await res.text()).toBe("");
        for (const call of vi.mocked(console.error).mock.calls) {
          expect(JSON.stringify(call)).not.toContain("secret detail");
        }
      } finally {
        state.db = real;
        vi.restoreAllMocks();
      }
    });

    it("C2: a raceId already started in another lobby is a conflict and keeps the row", async () => {
      const body = request();
      expect((await signed(body)).status).toBe(200);
      const elsewhere = await signed({ ...body, lobbyId: closed.id });
      expect(elsewhere.status).toBe(409);
      expect(await elsewhere.json()).toEqual({ v: PROTOCOL_VERSION, error: "conflict" });
      expect(await db.race.findUnique({ where: { id: body.raceId } })).toMatchObject({
        lobbyId: lobby.id,
      });
    });
  },
);
