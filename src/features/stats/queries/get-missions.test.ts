import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { dayNumber, MISSION_TEMPLATES } from "../view/missions";
import { countedWhere } from "./counted-where";
import { getMissions } from "./get-missions";

// The results index pulls in auth, which validates env at import (as get-profile.test.ts).
vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));

// #943 C17: getMissions reads the viewer's own counted results only, two columns, no write.

/** A Toronto day whose template is finish-3 (day number = 1 mod 3), at noon Toronto. */
function finishDay(): Date {
  for (let d = 10; d < 20; d++) {
    const key = `2026-11-${d}`;
    if (dayNumber(key) % MISSION_TEMPLATES.length === 1) return new Date(`${key}T17:00:00Z`);
  }
  throw new Error("unreachable");
}
const NOW = finishDay();
const DAY = 86_400_000;

describe("getMissions (stand-in client)", () => {
  it("a null viewer gets null without a query", async () => {
    const findMany = vi.fn();
    expect(
      await getMissions(null, { db: { raceResult: { findMany } } as never, now: NOW }),
    ).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("one query keyed by the viewer with the shared counted filter, selecting createdAt and accuracy", async () => {
    const findMany = vi.fn(async () => [
      { createdAt: NOW, accuracy: 0.9 },
      { createdAt: new Date(NOW.getTime() - DAY), accuracy: 0.99 },
    ]);
    const result = await getMissions(
      { id: "me" },
      { db: { raceResult: { findMany } } as never, now: NOW },
    );
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: countedWhere("me"),
      select: { createdAt: true, accuracy: true },
    });
    expect(result?.today).toEqual({ id: "finish-3", target: 3, progress: 1, complete: false });
  });
});

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "getMissions (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    const base = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    const db = base as unknown as Parameters<typeof getMissions>[1] extends infer O
      ? O extends { db?: infer D }
        ? D
        : never
      : never;
    const PREFIX = "test-get-missions-";
    const raceIds: string[] = [];

    const cleanup = async () => {
      await base.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
      await base.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };
    const user = async (name: string) =>
      (await base.user.create({ data: { isGuest: true, typistName: `${PREFIX}${name}` } })).id;

    type Desk = {
      userId: string | null;
      isBot?: boolean;
      suspicious?: boolean;
      status?: "FINISHED" | "TIMED_OUT" | "REASSIGNED";
    };
    async function race(
      at: Date,
      desks: Desk[],
      endReason: "ALL_FINISHED" | "VOID" = "ALL_FINISHED",
    ) {
      const id = randomUUID();
      raceIds.push(id);
      await base.race.create({
        data: {
          id,
          textContent: "le chat dort",
          textLanguage: "FR",
          textWordCount: 3,
          settings: { mode: "classic", durationS: 60 },
          startedAt: at,
          endedAt: at,
          endReason,
          engineVersion: "0.1.0",
          protocolVersion: 2,
        },
      });
      await base.raceResult.createMany({
        data: desks.map((d, desk) => ({
          raceId: id,
          desk,
          userId: d.userId,
          name: `${PREFIX}desk${desk}`,
          isBot: d.isBot ?? d.userId === null,
          place: desk + 1,
          status: d.status ?? "FINISHED",
          wpm: 40,
          rawWpm: 40,
          cleanWpm: 40,
          adjustedWpm: 40,
          accuracy: 0.97,
          progress: 1,
          correct: 10,
          errors: 0,
          total: 10,
          durationMs: 30_000,
          bonusesSent: 0,
          bonusesReceived: 0,
          bonusLog: [],
          suspicious: d.suspicious ?? false,
          engineVersion: "0.1.0",
          createdAt: at,
        })),
      });
    }

    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await base.$disconnect();
    });

    it("another user's, a bot's, a suspicious and a voided row never count; nothing is created", async () => {
      const me = await user("me");
      const other = await user("other");
      await race(NOW, [{ userId: me }, { userId: other }, { userId: null }]);
      await race(NOW, [{ userId: me, status: "TIMED_OUT" }]);
      await race(NOW, [{ userId: me, isBot: true }]);
      await race(NOW, [{ userId: me, suspicious: true }]);
      await race(NOW, [{ userId: me }], "VOID");
      await race(NOW, [{ userId: me, status: "REASSIGNED" }]);
      const mineWhere = { typistName: { startsWith: PREFIX } };
      const users = await base.user.count({ where: mineWhere });
      const results = await base.raceResult.count({ where: { raceId: { in: raceIds } } });

      const mine = await getMissions({ id: me }, { db, now: NOW });
      expect(mine?.today).toEqual({ id: "finish-3", target: 3, progress: 2, complete: false });
      expect(mine?.stars).toBe(0);
      const theirs = await getMissions({ id: other }, { db, now: NOW });
      expect(theirs?.today.progress).toBe(1);
      expect(await base.user.count({ where: mineWhere })).toBe(users);
      expect(await base.raceResult.count({ where: { raceId: { in: raceIds } } })).toBe(results);
    });
  },
);
