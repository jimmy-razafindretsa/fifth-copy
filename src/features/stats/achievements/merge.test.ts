import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { achievementMergeStep } from "./merge";

// #999 C35, ADR 0009: the guest-to-account merge carries achievements; a medal both hold stays once,
// with the earlier award time. (The registration and its coverage: identity/merge/coverage.test.ts.)

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("achievement merge step (needs TEST_DATABASE_URL)", () => {
  const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
  const PREFIX = "test-merge-ach-";
  let guestId: string;
  let accountId: string;
  const cleanup = () => db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });

  beforeEach(async () => {
    await cleanup();
    const tag = `${Date.now()}`;
    guestId = (await db.user.create({ data: { typistName: `${PREFIX}g${tag}` } })).id;
    accountId = (await db.user.create({ data: { typistName: `${PREFIX}a${tag}`, isGuest: false } }))
      .id;
  });
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("moves the guest's medals, keeps a shared one once with the earlier time, and empties the guest", async () => {
    const early = new Date("2026-10-01T12:00:00Z");
    const late = new Date("2026-11-01T12:00:00Z");
    await db.achievement.createMany({
      data: [
        { userId: guestId, achievementId: "first-win", awardedAt: early },
        { userId: guestId, achievementId: "wpm-50-club", awardedAt: late },
        { userId: accountId, achievementId: "first-win", awardedAt: late },
        { userId: accountId, achievementId: "accuracy-100", awardedAt: late },
      ],
    });
    const moved = await db.$transaction((tx) =>
      achievementMergeStep.run(tx as never, guestId, accountId, {
        afterCommit: () => {},
        onRollback: () => {},
      }),
    );
    expect(moved).toBe(2);
    expect(await db.achievement.count({ where: { userId: guestId } })).toBe(0);
    const rows = await db.achievement.findMany({
      where: { userId: accountId },
      orderBy: { achievementId: "asc" },
    });
    expect(rows.map((r) => [r.achievementId, r.awardedAt.toISOString()])).toEqual([
      ["accuracy-100", late.toISOString()],
      ["first-win", early.toISOString()],
      ["wpm-50-club", late.toISOString()],
    ]);
  });
});
