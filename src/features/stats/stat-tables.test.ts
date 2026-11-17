import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";

// #312 C1, C2: the per-key daily tables of prisma/schema/stats.prisma against the test database
// (ADR 0003): one row per (user, day, key), the key is unique, rows go with their user.

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** A stats day key (`src/lib/time.ts` dayKey) as the value of a `@db.Date` column. */
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const counts = { hits: 12, errors: 2, timedHits: 10, totalMs: 1_850 };

describe.skipIf(!testDatabaseUrl)("per-key daily stats tables (needs TEST_DATABASE_URL)", () => {
  const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
  const PREFIX = "test-stat-tables-";
  let userId: string;

  const cleanup = () => db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });

  beforeEach(async () => {
    await cleanup();
    userId = (await db.user.create({ data: { typistName: `${PREFIX}${Date.now()}` } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("C1 CharStatDaily: one row per (user, day, char, layout), the day is a calendar date", async () => {
    const row = { userId, day: day("2026-11-16"), char: "é", layout: "CSA" as const, ...counts };
    await db.charStatDaily.create({ data: row });

    await expect(db.charStatDaily.create({ data: row })).rejects.toMatchObject({ code: "P2002" });
    // another layout, another day or another char is another key
    await db.charStatDaily.create({ data: { ...row, layout: "US_QWERTY" } });
    await db.charStatDaily.create({ data: { ...row, day: day("2026-11-17") } });
    await db.charStatDaily.create({ data: { ...row, char: "e" } });

    const stored = await db.charStatDaily.findMany({
      where: { userId, day: day("2026-11-16") },
      orderBy: [{ char: "asc" }, { layout: "asc" }],
    });
    expect(stored.map((r) => [r.char, r.layout])).toEqual([
      ["e", "CSA"],
      ["é", "CSA"],
      ["é", "US_QWERTY"],
    ]);
    expect(stored[0]).toMatchObject(counts);
    expect(stored[0]!.day.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("C1 CharStatDaily rows are deleted with their user", async () => {
    await db.charStatDaily.create({
      data: { userId, day: day("2026-11-16"), char: "a", layout: "FR_CA", ...counts },
    });
    await db.user.delete({ where: { id: userId } });
    expect(await db.charStatDaily.count({ where: { userId } })).toBe(0);
  });

  it("C2 BigramStatDaily: one row per (user, day, pair), deleted with its user", async () => {
    const row = { userId, day: day("2026-11-16"), pair: "th", ...counts };
    await db.bigramStatDaily.create({ data: row });

    await expect(db.bigramStatDaily.create({ data: row })).rejects.toMatchObject({ code: "P2002" });
    await db.bigramStatDaily.create({ data: { ...row, pair: "ht" } });
    await db.bigramStatDaily.create({ data: { ...row, day: day("2026-11-17") } });
    expect(await db.bigramStatDaily.count({ where: { userId } })).toBe(3);

    await db.user.delete({ where: { id: userId } });
    expect(await db.bigramStatDaily.count({ where: { userId } })).toBe(0);
  });

  it("C3 RaceKeystrokes.rolledUpAt is nullable and null by default", async () => {
    const raceId = `${PREFIX}${Date.now()}`;
    await db.race.create({
      data: {
        id: raceId,
        textContent: "a",
        textLanguage: "EN",
        textWordCount: 1,
        settings: {},
        startedAt: new Date(),
        engineVersion: "test",
        protocolVersion: 1,
        keystrokes: { create: { desk: 0, userId, data: Buffer.from("x"), count: 1 } },
      },
    });
    try {
      const pending = await db.raceKeystrokes.findMany({ where: { raceId, rolledUpAt: null } });
      expect(pending).toHaveLength(1);
      const at = new Date();
      await db.raceKeystrokes.update({
        where: { raceId_desk: { raceId, desk: 0 } },
        data: { rolledUpAt: at },
      });
      expect(await db.raceKeystrokes.count({ where: { raceId, rolledUpAt: null } })).toBe(0);
    } finally {
      await db.race.delete({ where: { id: raceId } });
    }
  });
});
