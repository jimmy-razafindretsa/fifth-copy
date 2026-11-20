import "dotenv/config";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Keystroke } from "@fifth-copy/engine";
import { createPrismaClient } from "@/server/db-client";
import type { JobContext } from "@/worker/job";
import { rollupKeystrokes } from "../jobs/rollup-char-stats";
import { getCallouts } from "./query";

vi.mock("server-only", () => ({}));

// #999 C48: the callouts read only the viewer's own CharStatDaily rows of the last two stats weeks;
// a flagged result never yields a callout (its trace never reaches the daily rows).

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-19T17:00:00Z");

describe("getCallouts (C48)", () => {
  it("a visitor has none and nothing is read", async () => {
    const findMany = vi.fn();
    expect(await getCallouts(null, { db: { charStatDaily: { findMany } } as never })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("reads the viewer's own rows from the first day of last week, then applies the rule", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        day: new Date("2026-11-10T00:00:00Z"),
        char: "ç",
        hits: 30,
        errors: 0,
        timedHits: 30,
        totalMs: 18000,
      },
      {
        day: new Date("2026-11-18T00:00:00Z"),
        char: "ç",
        hits: 30,
        errors: 0,
        timedHits: 30,
        totalMs: 13846,
      },
    ]);
    const callouts = await getCallouts(
      { id: "u1" },
      { db: { charStatDaily: { findMany } } as never, now: NOW },
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u1", day: { gte: new Date("2026-11-06T00:00:00Z") } },
      select: { day: true, char: true, hits: true, errors: true, timedHits: true, totalMs: true },
    });
    expect(callouts).toEqual([{ kind: "faster", char: "ç", pct: 30 }]);
  });
});

describe.skipIf(!testDatabaseUrl)(
  "getCallouts against the test database (needs TEST_DATABASE_URL)",
  () => {
    const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    const PREFIX = "test-callouts-";
    const raceIds: string[] = [];
    const users: string[] = [];

    afterAll(async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
      await db.$disconnect();
    });

    const user = async () => {
      const id = (
        await db.user.create({ data: { typistName: `${PREFIX}${randomUUID().slice(0, 8)}` } })
      ).id;
      users.push(id);
      return id;
    };

    const TEXT = "ç".repeat(31);

    /** One finished race with the typist's trace: 31 presses `ms` apart (30 timed), filed at `at`. */
    const race = async (userId: string, at: string, ms: number, suspicious: boolean) => {
      const keys: Keystroke[] = [...TEXT].map((key, i) => ({ t: ms * (i + 1), key }));
      const raceId = randomUUID();
      raceIds.push(raceId);
      await db.race.create({
        data: {
          id: raceId,
          textContent: TEXT,
          textLanguage: "FR",
          textWordCount: 1,
          settings: { errorMode: "continue", backspace: true },
          startedAt: new Date(at),
          endedAt: new Date(at),
          endReason: "ALL_FINISHED",
          engineVersion: "0.1.0",
          protocolVersion: 1,
          results: {
            create: {
              desk: 1,
              userId,
              name: "Typist",
              isBot: false,
              place: 1,
              status: "FINISHED",
              wpm: 50,
              rawWpm: 50,
              cleanWpm: 50,
              adjustedWpm: 50,
              accuracy: 1,
              progress: 1,
              correct: keys.length,
              errors: 0,
              total: keys.length,
              durationMs: 10_000,
              finishedAtMs: 10_000,
              bonusesSent: 0,
              bonusesReceived: 0,
              bonusLog: [],
              suspicious,
              engineVersion: "0.1.0",
              createdAt: new Date(at),
            },
          },
          keystrokes: {
            create: {
              desk: 1,
              userId,
              data: new Uint8Array(gzipSync(JSON.stringify(keys))),
              count: keys.length,
            },
          },
        },
      });
    };

    const rollup = () =>
      rollupKeystrokes(
        {
          db,
          now: NOW,
          log: { info: () => undefined, error: () => undefined } as JobContext["log"],
        },
        { only: { userId: { in: users } } },
      );

    it("a counted typist 30 % faster on ç gets the callout; a flagged one gets none", async () => {
      const counted = await user();
      const flagged = await user();
      for (const [u, suspicious] of [
        [counted, false],
        [flagged, true],
      ] as const) {
        await race(u, "2026-11-10T17:00:00Z", 130, suspicious);
        await race(u, "2026-11-18T17:00:00Z", 100, suspicious);
      }
      await rollup();
      expect(await getCallouts({ id: counted }, { db, now: NOW })).toEqual([
        { kind: "faster", char: "ç", pct: 30 },
      ]);
      expect(await getCallouts({ id: flagged }, { db, now: NOW })).toEqual([]);
    });
  },
);
