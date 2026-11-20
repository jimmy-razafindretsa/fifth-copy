import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { personalBestMergeStep } from "./merge";

// #999 C41, ADR 0009: the guest-to-account merge carries personal bests; on a shared key the faster
// stays (a tie keeps the account's).

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("personal best merge step (needs TEST_DATABASE_URL)", () => {
  const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
  const PREFIX = "test-merge-pb-";
  let guestId: string;
  let accountId: string;
  const cleanup = () => db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
  const at = new Date("2026-11-01T12:00:00Z");
  const best = (userId: string, length: "SHORT" | "MEDIUM" | "LONG", cleanWpm: number) => ({
    userId,
    language: "FR" as const,
    textType: "SENTENCES" as const,
    length,
    cleanWpm,
    accuracy: 0.95,
    achievedAt: at,
  });

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

  it("moves the guest's bests; on a shared key the faster stays; a tie keeps the account's", async () => {
    await db.personalBest.createMany({
      data: [
        best(guestId, "SHORT", 60),
        best(guestId, "MEDIUM", 30),
        best(guestId, "LONG", 45),
        best(accountId, "SHORT", 50),
        best(accountId, "MEDIUM", 40),
        { ...best(accountId, "LONG", 45), accuracy: 0.5 },
      ],
    });
    const moved = await db.$transaction((tx) =>
      personalBestMergeStep.run(tx as never, guestId, accountId, {
        afterCommit: () => {},
        onRollback: () => {},
      }),
    );
    expect(moved).toBe(3);
    expect(await db.personalBest.count({ where: { userId: guestId } })).toBe(0);
    const rows = await db.personalBest.findMany({
      where: { userId: accountId },
      orderBy: { length: "asc" },
    });
    expect(rows.map((r) => [r.length, r.cleanWpm, r.accuracy])).toEqual([
      ["SHORT", 60, 0.95],
      ["MEDIUM", 40, 0.95],
      ["LONG", 45, 0.5],
    ]);
  });
});
