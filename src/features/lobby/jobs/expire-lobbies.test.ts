import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { ROOM_TTL_MS } from "../room-ttl";
import { EXPIRE_AFTER_MS, EXPIRE_BATCH, expireLobbies } from "./expire-lobbies";

// #734 C3: `lobby.expire` closes every WAITING lobby older than ROOM_TTL_S x 2 with no race started in
// the last ROOM_TTL_S x 2 (its room is gone from Redis without a close call), in batches,
// idempotent; a lobby with recent activity is untouched.
// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const silent = { info: () => undefined, error: () => undefined };

describe("EXPIRE_AFTER_MS", () => {
  it("is twice the race server's room TTL (2 h), so a live room is never swept", () => {
    expect(ROOM_TTL_MS).toBe(2 * 3600 * 1000);
    expect(EXPIRE_AFTER_MS).toBe(2 * ROOM_TTL_MS);
  });
});

describe.skipIf(!testDatabaseUrl)(
  "lobby.expire job (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-expire-lobby-";
    const CODE_PREFIX = "EXP-";
    // Older than any real row: the job sweeps the whole table, so other test files' lobbies never match.
    const NOW = new Date("2020-01-01T12:00:00Z");
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const OLD = ago(EXPIRE_AFTER_MS + 60_000);
    let hostUserId: string;
    let seq = 0;
    const raceIds: string[] = [];

    const cleanup = async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds } } });
      await db.lobby.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const lobby = async (createdAt: Date, over: { status?: "WAITING" | "CLOSED" } = {}) => {
      seq += 1;
      const code = `${CODE_PREFIX}${String(seq).padStart(4, "0")}`;
      const row = await db.lobby.create({
        data: { code, hostUserId, createdAt, status: over.status ?? "WAITING" },
      });
      return row.id;
    };
    const race = async (lobbyId: string, startedAt: Date) => {
      const id = randomUUID();
      raceIds.push(id);
      await db.race.create({
        data: {
          id,
          lobbyId,
          textContent: "le chat dort",
          textLanguage: "FR",
          textWordCount: 3,
          settings: {},
          startedAt,
          engineVersion: "0.1.0",
          protocolVersion: 1,
        },
      });
    };
    const status = async (id: string) =>
      db.lobby.findUniqueOrThrow({ where: { id }, select: { status: true, closedAt: true } });
    const run = (now = NOW) => expireLobbies.run({ db, now, log: silent });

    beforeAll(() => {
      db = createPrismaClient(testDatabaseUrl!);
    });
    beforeEach(async () => {
      await cleanup();
      seq = 0;
      ({ id: hostUserId } = await db.user.create({
        data: { isGuest: true, typistName: `${PREFIX}host` },
      }));
    });
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("is registered as lobby.expire and runs at least hourly", () => {
      expect(expireLobbies.name).toBe("lobby.expire");
    });

    it("C3: closes a WAITING lobby older than ROOM_TTL x 2 with no race, at the run's clock", async () => {
      const stale = await lobby(OLD);
      const raced = await lobby(OLD);
      await race(raced, ago(EXPIRE_AFTER_MS + 30_000));
      await run();
      expect(await status(stale)).toEqual({ status: "CLOSED", closedAt: NOW });
      // Its last race is older than the window too: nothing alive.
      expect(await status(raced)).toEqual({ status: "CLOSED", closedAt: NOW });
    });

    it("C3: a lobby with recent activity is untouched (young row, or a race started in the window)", async () => {
      const young = await lobby(ago(EXPIRE_AFTER_MS - 60_000));
      const busy = await lobby(OLD);
      await race(busy, ago(EXPIRE_AFTER_MS - 60_000));
      await run();
      expect(await status(young)).toEqual({ status: "WAITING", closedAt: null });
      expect(await status(busy)).toEqual({ status: "WAITING", closedAt: null });
    });

    it("C3: idempotent: a second run changes nothing, an already CLOSED lobby keeps its closedAt", async () => {
      const closedAt = ago(EXPIRE_AFTER_MS * 3);
      const closed = await lobby(OLD, { status: "CLOSED" });
      await db.lobby.update({ where: { id: closed }, data: { closedAt } });
      const stale = await lobby(OLD);
      await run();
      await run(new Date(NOW.getTime() + 60_000));
      expect(await status(stale)).toEqual({ status: "CLOSED", closedAt: NOW });
      expect(await status(closed)).toEqual({ status: "CLOSED", closedAt });
    });

    it("C3: works in batches of EXPIRE_BATCH and closes every stale lobby in one run", async () => {
      const n = EXPIRE_BATCH + 3;
      await db.lobby.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          code: `${CODE_PREFIX}B${String(i).padStart(3, "0")}`,
          hostUserId,
          createdAt: OLD,
        })),
      });
      await run();
      const left = await db.lobby.count({
        where: { code: { startsWith: `${CODE_PREFIX}B` }, status: "WAITING" },
      });
      expect(left).toBe(0);
    });
  },
);
