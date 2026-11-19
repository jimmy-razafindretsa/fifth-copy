import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { durationMs, type JobContext, type JobLogger } from "@/worker/job";
import {
  LETTER_PAIR_RETENTION_DAYS,
  PURGE_BATCH,
  PURGE_MAX_BATCHES,
  RAW_KEYSTROKES_RETENTION_DAYS,
  SPEED_CURVE_RETENTION_DAYS,
  purgeExpiredStats,
  purgeKeystrokes,
} from "./purge-keystrokes";

// #315: the purge job enforces two retention periods of docs/privacy/retention.md (ADR 0008, 0011,
// 0024): raw keystrokes 30 days after the race, daily letter-pair stats 90 days after the stats day.
// DB-backed tests target the test database (ADR 0003) and scope every run to their own typists,
// since other test files share that database.

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T12:00:00Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const repo = (...p: string[]) => readFileSync(path.join(__dirname, "../../../..", ...p), "utf8");

type Line = { msg: string; fields?: Record<string, string | number | boolean | null> };
const recorder = () => {
  const lines: Line[] = [];
  const log: JobLogger = {
    info: (msg, fields) => lines.push({ msg, fields }),
    error: (msg, fields) => lines.push({ msg, fields }),
  };
  return { lines, log };
};

describe("purgeKeystrokes job (C1, C3, C5)", () => {
  it("C1 is named, starts at most 6 hours apart and is listed in the worker registry", () => {
    expect(purgeKeystrokes.name).toBe("stats.purge");
    expect(durationMs(purgeKeystrokes.every)).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
    expect(repo("src/worker/registry.ts")).toMatch(
      /import \{ purgeKeystrokes \} from "@\/features\/stats\/jobs\/purge-keystrokes";[\s\S]*export const jobs[^;]*purgeKeystrokes/,
    );
  });

  it("C3 deletes in batches of at most 1000 rows, at most 50 batches per run", () => {
    expect(PURGE_BATCH).toBe(1000);
    expect(PURGE_MAX_BATCHES).toBe(50);
  });

  it("C5 the periods are the ones docs/privacy/retention.md states", () => {
    expect(RAW_KEYSTROKES_RETENTION_DAYS).toBe(30);
    expect(LETTER_PAIR_RETENTION_DAYS).toBe(90);
    const retention = repo("docs/privacy/retention.md");
    const days = (label: string) => {
      const row = retention.split("\n").find((l) => l.startsWith(`| ${label} |`));
      expect(row, label).toBeTruthy();
      return Number(/^\| [^|]+ \| (\d+) days\b/.exec(row!)?.[1]);
    };
    expect(days("Raw keystrokes")).toBe(RAW_KEYSTROKES_RETENTION_DAYS);
    expect(days("Daily letter-pair stats")).toBe(LETTER_PAIR_RETENTION_DAYS);
    expect(days("Race speed curves (`RaceResult.wpmSeries`, #952)")).toBe(
      SPEED_CURVE_RETENTION_DAYS,
    );
  });

  it("C5 the retention and inventory rows name this job as shipped", () => {
    const shipped = "`stats.purge` worker job (#315, shipped)";
    const retention = repo("docs/privacy/retention.md").split("\n");
    const inventory = repo("docs/privacy/inventory.md").split("\n");
    for (const label of ["Raw keystrokes", "Daily letter-pair stats"]) {
      expect(
        retention.find((l) => l.startsWith(`| ${label} |`)),
        label,
      ).toContain(shipped);
      expect(
        inventory.find((l) => l.startsWith(`| ${label} |`)),
        label,
      ).toContain(shipped);
    }
  });
});

describe.skipIf(!testDatabaseUrl)(
  "purgeExpiredStats against the test database (needs TEST_DATABASE_URL)",
  () => {
    const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
    const PREFIX = "test-purge-keys-";
    const raceIds: string[] = [];
    let users: string[] = [];

    const cleanup = async () => {
      await db.race.deleteMany({ where: { id: { in: raceIds } } });
      await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
    };

    const user = async () => {
      const { id } = await db.user.create({
        data: { typistName: `${PREFIX}${randomUUID().slice(0, 8)}` },
      });
      users.push(id);
      return id;
    };

    /** One race with one result and `desks` stored traces, each created `ageMs` before NOW. */
    const race = async (userId: string, ageMs: number, desks = 1, rolledUp = false) => {
      const raceId = randomUUID();
      raceIds.push(raceId);
      const createdAt = new Date(NOW.getTime() - ageMs);
      await db.race.create({
        data: {
          id: raceId,
          textContent: "le chat",
          textLanguage: "FR",
          textWordCount: 2,
          settings: { errorMode: "continue", backspace: true },
          startedAt: createdAt,
          endedAt: createdAt,
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
              correct: 7,
              errors: 0,
              total: 7,
              durationMs: 10_000,
              finishedAtMs: 10_000,
              bonusesSent: 0,
              bonusesReceived: 0,
              bonusLog: [],
              engineVersion: "0.1.0",
              // the speed curve filed with it (ADR 0027), as old as its keys
              wpmSeries: [[10_000, 50]],
              createdAt,
            },
          },
        },
      });
      await db.raceKeystrokes.createMany({
        data: Array.from({ length: desks }, (_, i) => ({
          raceId,
          desk: i + 1,
          userId,
          data: new Uint8Array([1, 2, 3]),
          count: 7,
          createdAt,
          rolledUpAt: rolledUp ? createdAt : null,
        })),
      });
      return raceId;
    };

    const pairs = async (userId: string, days: string[]) => {
      await db.bigramStatDaily.createMany({
        data: days.map((day) => ({
          userId,
          day: new Date(`${day}T00:00:00Z`),
          pair: "le",
          hits: 1,
          errors: 0,
          timedHits: 1,
          totalMs: 100,
        })),
      });
    };

    const run = (log = recorder().log, limits?: { batch?: number }) =>
      purgeExpiredStats({ db, now: NOW, log } as JobContext, { userIds: users, ...limits });

    const keysLeft = () => db.raceKeystrokes.count({ where: { userId: { in: users } } });

    beforeEach(async () => {
      await cleanup();
      users = [];
    });

    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("C1 deletes keystrokes older than 30 days, rolled up or not, and leaves races and results", async () => {
      const u = await user();
      const young = await race(u, 30 * DAY - 60 * MINUTE); // 29 days 23 hours
      const rolled = await race(u, 30 * DAY + MINUTE, 1, true);
      const unrolled = await race(u, 30 * DAY + MINUTE, 1, false);
      const ancient = await race(u, 400 * DAY);

      await run();

      const left = await db.raceKeystrokes.findMany({
        where: { userId: u },
        select: { raceId: true },
      });
      expect(left.map((k) => k.raceId)).toEqual([young]);
      for (const id of [young, rolled, unrolled, ancient]) {
        expect(await db.race.count({ where: { id } }), id).toBe(1);
        expect(await db.raceResult.count({ where: { raceId: id } }), id).toBe(1);
      }
    });

    it("#999 C53 clears speed curves filed more than 30 days ago and keeps the result rows", async () => {
      const u = await user();
      const young = await race(u, 30 * DAY - 60 * MINUTE);
      const old = await race(u, 30 * DAY + MINUTE);

      await run();

      const rows = await db.raceResult.findMany({
        where: { userId: u },
        select: { raceId: true, wpmSeries: true, cleanWpm: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.raceId === young)?.wpmSeries).toEqual([[10_000, 50]]);
      expect(rows.find((r) => r.raceId === old)).toEqual({
        raceId: old,
        wpmSeries: null,
        cleanWpm: 50,
      });
    });

    it("C2 deletes letter-pair days more than 90 days before the stats day and never char stats", async () => {
      const u = await user();
      // NOW is 2026-11-17 in America/Toronto; 90 days before is 2026-08-19.
      await pairs(u, ["2026-08-17", "2026-08-18", "2026-08-19", "2026-11-16"]);
      await db.charStatDaily.create({
        data: {
          userId: u,
          day: new Date("2025-01-01T00:00:00Z"),
          char: "e",
          layout: "CSA",
          hits: 1,
          errors: 0,
          timedHits: 1,
          totalMs: 100,
        },
      });

      await run();

      const days = await db.bigramStatDaily.findMany({
        where: { userId: u },
        orderBy: { day: "asc" },
        select: { day: true },
      });
      expect(days.map((d) => d.day.toISOString().slice(0, 10))).toEqual([
        "2026-08-19",
        "2026-11-16",
      ]);
      expect(await db.charStatDaily.count({ where: { userId: u } })).toBe(1);
    });

    it("C2 the stats day is the America/Toronto day of now", async () => {
      const u = await user();
      await pairs(u, ["2026-08-18"]);
      // 03:00 UTC on 2026-11-18 is still 2026-11-17 in Toronto: 2026-08-18 is 91 days old there.
      await purgeExpiredStats(
        { db, now: new Date("2026-11-18T03:00:00Z"), log: recorder().log } as JobContext,
        { userIds: users },
      );
      expect(await db.bigramStatDaily.count({ where: { userId: u } })).toBe(0);

      await pairs(u, ["2026-08-19"]);
      await purgeExpiredStats(
        { db, now: new Date("2026-11-18T03:00:00Z"), log: recorder().log } as JobContext,
        { userIds: users },
      );
      expect(await db.bigramStatDaily.count({ where: { userId: u } })).toBe(1);
    });

    it("C3 2 500 old rows go in one run; a second run deletes only what is newly due", async () => {
      const u = await user();
      await race(u, 31 * DAY, 2_500);
      const due = await race(u, 30 * DAY - MINUTE);

      const first = recorder();
      await run(first.log);
      expect(await keysLeft()).toBe(1);
      expect(first.lines.at(-1)?.fields).toMatchObject({ raceKeystrokes: 2_500 });

      const second = recorder();
      await run(second.log);
      expect(second.lines.at(-1)?.fields).toMatchObject({ raceKeystrokes: 0, bigramStatDaily: 0 });
      expect(await keysLeft()).toBe(1);

      // two minutes later the young trace is due, and only it goes
      const later = recorder();
      await purgeExpiredStats(
        { db, now: new Date(NOW.getTime() + 2 * MINUTE), log: later.log } as JobContext,
        { userIds: users },
      );
      expect(later.lines.at(-1)?.fields).toMatchObject({ raceKeystrokes: 1 });
      expect(await db.raceKeystrokes.count({ where: { raceId: due } })).toBe(0);
    });

    it("C3 stops after 50 batches; the next run carries on", async () => {
      const u = await user();
      await race(u, 31 * DAY, 120);
      const log = recorder();
      await run(log.log, { batch: 2 }); // 50 batches of 2 rows = 100 rows at most
      expect(await keysLeft()).toBe(20);
      expect(log.lines.at(-1)?.fields).toMatchObject({ raceKeystrokes: 100, batches: 50 });
      await run(recorder().log, { batch: 2 });
      expect(await keysLeft()).toBe(0);
    });

    it("C3 a crash between batches loses nothing: done batches stay done, the rest waits", async () => {
      const u = await user();
      const young = await race(u, DAY);
      await race(u, 31 * DAY, 5);
      let calls = 0;
      const crashing = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "$queryRaw") {
            return (...args: Parameters<typeof db.$queryRaw>) => {
              calls += 1;
              if (calls === 2) throw new Error("worker killed");
              return target.$queryRaw(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      await expect(
        purgeExpiredStats({ db: crashing, now: NOW, log: recorder().log } as JobContext, {
          userIds: users,
          batch: 2,
        }),
      ).rejects.toThrow("worker killed");
      expect(await keysLeft()).toBe(4); // one batch of 2 went, the young trace and 3 old remain

      await run();
      const left = await db.raceKeystrokes.findMany({
        where: { userId: u },
        select: { raceId: true },
      });
      expect(left.map((k) => k.raceId)).toEqual([young]);
    });

    it("C4 one log line per run: counts per table and the never rolled up count, nothing else", async () => {
      const u = await user();
      await race(u, 31 * DAY, 3, false);
      await race(u, 31 * DAY, 2, true);
      await pairs(u, ["2026-01-01", "2026-01-02"]);
      const { lines, log } = recorder();

      await run(log);

      expect(lines).toEqual([
        {
          msg: "stats purged",
          fields: {
            raceKeystrokes: 5,
            neverRolledUp: 3,
            wpmSeries: 2,
            bigramStatDaily: 2,
            batches: 3,
          },
        },
      ]);
    });
  },
);
