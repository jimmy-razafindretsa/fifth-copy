import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLobbyHostResponseSchema, PROTOCOL_VERSION } from "@fifth-copy/protocol";
import { createPrismaClient } from "@/server/db-client";
import { internalHeaders } from "@/server/internal-api/sign";

// #137 C3: `POST /api/internal/lobbies/:id/host` (race server -> web after the room promoted a new
// host): HMAC + nonce like `/api/internal/races`, sets `Lobby.hostUserId`, idempotent; unsigned,
// replayed and unknown-id calls, and a host id that is no `User`, are refused with the bare code only.
// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "internal-lobby-host-route-test-secret-0123456789";

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

const { POST } = await import("./[id]/host/route");

const nowS = () => Math.floor(Date.now() / 1000);

function post(id: string, rawBody: string, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://web.test/api/internal/lobbies/${encodeURIComponent(id)}/host`, {
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
  "POST /api/internal/lobbies/:id/host (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-host-lobby-";
    const CODE = "HST-1370";
    let lobbyId: string;
    let oldHost: string;
    let promoted: string;
    const body = (over: Record<string, unknown> = {}) => ({
      v: PROTOCOL_VERSION,
      lobbyId,
      hostUserId: promoted,
      ...over,
    });
    const hostOf = async () =>
      (await db.lobby.findUniqueOrThrow({ where: { id: lobbyId }, select: { hostUserId: true } }))
        .hostUserId;

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
      const a = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}a` } });
      oldHost = host.id;
      promoted = a.id;
      ({ id: lobbyId } = await db.lobby.create({ data: { code: CODE, hostUserId: host.id } }));
    });
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("C3: records the promoted user as the lobby's host; the same call again answers ok without a write", async () => {
      const first = await signed(lobbyId, body());
      expect(first.status).toBe(200);
      expect(setLobbyHostResponseSchema.parse(await first.json())).toEqual({
        v: PROTOCOL_VERSION,
        lobbyId,
        changed: true,
      });
      expect(await hostOf()).toBe(promoted);
      const before = await db.lobby.findUniqueOrThrow({ where: { id: lobbyId } });

      const again = await signed(lobbyId, body());
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ v: PROTOCOL_VERSION, lobbyId, changed: false });
      expect(await db.lobby.findUniqueOrThrow({ where: { id: lobbyId } })).toEqual(before);
    });

    it("C3: an unsigned call is 401 and changes nothing", async () => {
      const res = await post(lobbyId, JSON.stringify(body()));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "stale-timestamp" });
      expect(await hostOf()).toBe(oldHost);
    });

    it("C3: a wrong signature is 401 bad-signature and changes nothing", async () => {
      const rawBody = JSON.stringify(body());
      const headers = internalHeaders({ rawBody, secret: "not-the-secret", now: nowS() });
      const res = await post(lobbyId, rawBody, headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ v: PROTOCOL_VERSION, error: "bad-signature" });
      expect(await hostOf()).toBe(oldHost);
    });

    it("C3: a replayed call is 401 replay and changes nothing more", async () => {
      const rawBody = JSON.stringify(body());
      const headers = internalHeaders({ rawBody, secret: SECRET, now: nowS() });
      expect((await post(lobbyId, rawBody, headers)).status).toBe(200);
      await db.lobby.update({ where: { id: lobbyId }, data: { hostUserId: oldHost } });
      const replay = await post(lobbyId, rawBody, headers);
      expect(replay.status).toBe(401);
      expect(await replay.json()).toEqual({ v: PROTOCOL_VERSION, error: "replay" });
      expect(await hostOf()).toBe(oldHost);
    });

    it("C3: an unknown lobby id, or a host id that is no User, is 404 not-found with no other detail", async () => {
      const unknown = await signed("lob_unknown_137", body({ lobbyId: "lob_unknown_137" }));
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ v: PROTOCOL_VERSION, error: "not-found" });
      const noUser = await signed(lobbyId, body({ hostUserId: "usr_not_a_user_137" }));
      expect(noUser.status).toBe(404);
      expect(await noUser.json()).toEqual({ v: PROTOCOL_VERSION, error: "not-found" });
      expect(await hostOf()).toBe(oldHost);
    });

    it("refuses a path id other than the body's, a bad body and an old version; nothing changes", async () => {
      expect((await signed("lob_other", body())).status).toBe(400);
      expect((await signed(lobbyId, { v: PROTOCOL_VERSION, lobbyId })).status).toBe(400);
      expect((await signed(lobbyId, body({ v: PROTOCOL_VERSION - 1 }))).status).toBe(426);
      expect(await hostOf()).toBe(oldHost);
    });

    it("an unavailable nonce store is a bare 503 and changes nothing", async () => {
      store.outage = true;
      const res = await signed(lobbyId, body());
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("");
      expect(await hostOf()).toBe(oldHost);
    });
  },
);
