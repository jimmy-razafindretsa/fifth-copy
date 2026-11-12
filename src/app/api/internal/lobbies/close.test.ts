import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeLobbyResponseSchema, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { createPrismaClient } from "@/server/db-client";
import { internalHeaders } from "@/server/internal-api/sign";

// #734 C1: `POST /api/internal/lobbies/:id/close` (race server -> web when the last human leaves):
// HMAC + nonce like `/api/internal/races`, sets the `Lobby` CLOSED once, idempotent; unsigned,
// replayed and unknown-id calls are refused with the bare protocol error code only.
// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "internal-lobby-close-route-test-secret-0123456789";

const state = vi.hoisted(() => ({ db: null as unknown }));
const store = vi.hoisted(() => ({ seen: new Set<string>(), outage: false }));
vi.mock("@/env", () => ({ env: { NODE_ENV: "test", RACE_TOKEN_SECRET: SECRET } }));
vi.mock("@/server/internal-api/nonces", () => ({
  webNonceStore: () => ({
    claim: async (nonce: string) => {
      if (store.outage) return "unavailable";
      if (store.seen.has(nonce)) return "replay";
      store.seen.add(nonce);
      return "claimed";
    },
  }),
}));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { POST } = await import("./[id]/close/route");

const nowS = () => Math.floor(Date.now() / 1000);

function post(id: string, rawBody: string, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://web.test/api/internal/lobbies/${encodeURIComponent(id)}/close`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: rawBody,
    }),
    { params: Promise.resolve({ id }) },
  );
}
const signed = (id: string, body: unknown) => {
  const rawBody = JSON.stringify(body);
  return post(id, rawBody, internalHeaders({ rawBody, secret: SECRET, now: nowS() }));
};

describe.skipIf(!testDatabaseUrl)(
  "POST /api/internal/lobbies/:id/close (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-close-lobby-";
    const CODE = "CLS-7340";
    let lobbyId: string;
    const CLOSED_AT = Date.parse("2026-11-09T12:00:00Z");
    const body = (over: Record<string, unknown> = {}) => ({
      v: PROTOCOL_VERSION,
      lobbyId,
      closedAt: CLOSED_AT,
      ...over,
    });
    const row = () =>
      db.lobby.findUniqueOrThrow({
        where: { id: lobbyId },
        select: { status: true, closedAt: true },
      });

    const cleanup = async () => {
      await db.lobby.deleteMany({ where: { code: CODE } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };

    beforeAll(() => {
      db = createPrismaClient(testDatabaseUrl!);
      state.db = db;
    });
    beforeEach(async () => {
      store.seen.clear();
      store.outage = false;
      await cleanup();
      const host = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}host` } });
      ({ id: lobbyId } = await db.lobby.create({ data: { code: CODE, hostUserId: host.id } }));
    });
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("C1: closes a WAITING lobby at closedAt; a second call answers ok without a change", async () => {
      const first = await signed(lobbyId, body());
      expect(first.status).toBe(200);
      expect(closeLobbyResponseSchema.parse(await first.json())).toEqual({
        v: PROTOCOL_VERSION,
        lobbyId,
        changed: true,
      });
      expect(await row()).toEqual({ status: "CLOSED", closedAt: new Date(CLOSED_AT) });

      const again = await signed(lobbyId, body({ closedAt: CLOSED_AT + 60_000 }));
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ v: PROTOCOL_VERSION, lobbyId, changed: false });
      // The first close stands: its time is never moved.
      expect(await row()).toEqual({ status: "CLOSED", closedAt: new Date(CLOSED_AT) });
    });

    it("C1: an unsigned call is 401 and changes nothing", async () => {
      const res = await post(lobbyId, JSON.stringify(body()));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "stale-timestamp" });
      expect((await row()).status).toBe("WAITING");
    });

    it("C1: a wrong signature is 401 bad-signature and changes nothing", async () => {
      const rawBody = JSON.stringify(body());
      const headers = internalHeaders({ rawBody, secret: "not-the-secret", now: nowS() });
      const res = await post(lobbyId, rawBody, headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "bad-signature" });
      expect((await row()).status).toBe("WAITING");
    });

    it("C1: a replayed call is 401 replay", async () => {
      const rawBody = JSON.stringify(body());
      const headers = internalHeaders({ rawBody, secret: SECRET, now: nowS() });
      expect((await post(lobbyId, rawBody, headers)).status).toBe(200);
      const replay = await post(lobbyId, rawBody, headers);
      expect(replay.status).toBe(401);
      expect(await replay.json()).toEqual({ v: PROTOCOL_VERSION, error: "replay" });
    });

    it("C1: an unknown lobby id is 404 not-found with no other detail", async () => {
      const res = await signed("lob_unknown_734", body({ lobbyId: "lob_unknown_734" }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "not-found" });
    });

    it("refuses a path id other than the body's, a bad body and an old version; nothing changes", async () => {
      const mismatch = await signed("lob_other", body());
      expect(mismatch.status).toBe(400);
      const noDate = await signed(lobbyId, { v: PROTOCOL_VERSION, lobbyId });
      expect(noDate.status).toBe(400);
      const old = await signed(lobbyId, body({ v: PROTOCOL_VERSION - 1 }));
      expect(old.status).toBe(426);
      expect((await row()).status).toBe("WAITING");
    });

    it("#716: an unavailable nonce store is a bare 503 and changes nothing", async () => {
      store.outage = true;
      const res = await signed(lobbyId, body());
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("");
      expect((await row()).status).toBe("WAITING");
    });
  },
);
