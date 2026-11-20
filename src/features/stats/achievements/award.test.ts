import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { statsDayNoon } from "@/lib/time";
import { createRace, requestOf, type FilingDesk } from "../testing/filing";
import { awardAchievementsStep } from "./award";

// The results index pulls in auth, which validates env at import (as get-profile.test.ts).
vi.mock("@/env", () => ({
  env: { NODE_ENV: "test", AUTH_SECRET: "m".repeat(32), RACE_TOKEN_SECRET: "r".repeat(32) },
}));
const { persistRaceResults } = await import("@/features/results");

// #999 C35: award rules run after each result is saved, inside the filing transaction; each medal at
// most once (the table's key); never from a flagged result; clean WPM (ADR 0016).

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("awardAchievements (needs TEST_DATABASE_URL)", () => {
  const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
  const PREFIX = "test-award-";
  const raceIds: string[] = [];

  const cleanup = async () => {
    await db.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
    await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
  };
  const user = async (name: string) =>
    (await db.user.create({ data: { typistName: `${PREFIX}${name}-${Date.now()}` } })).id;
  const held = async (userId: string) =>
    (
      await db.achievement.findMany({
        where: { userId },
        select: { achievementId: true },
        orderBy: { achievementId: "asc" },
      })
    ).map((a) => a.achievementId);

  const file = async (
    desks: FilingDesk[],
    race: Parameters<typeof createRace>[1] = {},
    now?: Date,
  ) => {
    const id = await createRace(db, race);
    raceIds.push(id);
    const out = await persistRaceResults(requestOf(id, desks, race.lobbySize), {
      db: db as never,
      afterSave: [awardAchievementsStep(now ? { now: () => now } : {})],
    });
    expect(out.ok).toBe(true);
    return id;
  };

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("awards after the result is saved, in the same filing; a bot desk earns nothing", async () => {
    const me = await user("me");
    const other = await user("other");
    await file([
      { userId: me, place: 1, cleanWpm: 52, accuracy: 1 },
      { userId: other, place: 2, cleanWpm: 30 },
      { userId: null, place: 3, cleanWpm: 90 },
    ]);
    expect(await held(me)).toEqual(["accuracy-100", "first-win", "wpm-50-club"]);
    expect(await held(other)).toEqual([]);
  });

  it("each achievement at most once: a repeated filing and a later race change nothing", async () => {
    const me = await user("me");
    const desks = [{ userId: me, place: 1, cleanWpm: 60 }, { userId: null }];
    const raceId = await file(desks);
    const first = await db.achievement.findMany({ where: { userId: me } });
    // the race server retries the same chunk
    await persistRaceResults(requestOf(raceId, desks), {
      db: db as never,
      afterSave: [awardAchievementsStep()],
    });
    await file(desks);
    const after = await db.achievement.findMany({ where: { userId: me } });
    expect(after).toHaveLength(2);
    expect(after.map((a) => a.awardedAt.getTime()).sort()).toEqual(
      first.map((a) => a.awardedAt.getTime()).sort(),
    );
  });

  it("never from a flagged result, however fast and accurate", async () => {
    const me = await user("me");
    await file(
      [
        { userId: me, place: 1, cleanWpm: 150, accuracy: 1, flagged: true },
        { userId: null, place: 2 },
      ],
      { accentEveryWord: true },
    );
    expect(await held(me)).toEqual([]);
  });

  it("accent master on an accent text; the 50 WPM club reads clean WPM only", async () => {
    const me = await user("me");
    await file(
      [
        { userId: me, place: 2, cleanWpm: 49.9, accuracy: 0.96 },
        { userId: null, place: 1 },
      ],
      {
        textType: "special-characters",
      },
    );
    expect(await held(me)).toEqual(["accent-master"]);
  });

  it("the 7-day streak: counted races on six earlier stats days plus today's; a flagged day breaks it", async () => {
    const me = await user("me");
    const now = new Date();
    const seed = async (daysAgo: number, suspicious = false) => {
      const at = statsDayNoon(daysAgo, now);
      const id = await createRace(db);
      raceIds.push(id);
      await db.race.update({ where: { id }, data: { endedAt: at, endReason: "ALL_FINISHED" } });
      await db.raceResult.create({
        data: {
          raceId: id,
          desk: 1,
          userId: me,
          name: "Clerk",
          isBot: false,
          place: 1,
          status: "FINISHED",
          wpm: 20,
          rawWpm: 20,
          cleanWpm: 20,
          adjustedWpm: 20,
          accuracy: 0.9,
          progress: 1,
          correct: 1,
          errors: 0,
          total: 1,
          durationMs: 1_000,
          bonusesSent: 0,
          bonusesReceived: 0,
          bonusLog: [],
          suspicious,
          engineVersion: "0.1.0",
          createdAt: at,
        },
      });
    };
    for (const d of [1, 2, 3, 4, 5]) await seed(d);
    await seed(6, true);
    const solo = [{ userId: me, place: 1 }];
    await file(solo, { lobbySize: 1 }, now);
    expect(await held(me)).toEqual([]);
    await seed(6);
    await file(solo, { lobbySize: 1 }, now);
    expect(await held(me)).toEqual(["streak-7-days"]);
  });
});
