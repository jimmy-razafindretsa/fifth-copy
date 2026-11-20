import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MergeStep } from "@/features/identity";
import { createPrismaClient } from "@/server/db-client";

// #312 C4: the guest merge (ADR 0009) carries the guest's per-key daily rows to the account; a key
// the account already has is summed and the guest row goes. Runs the registered steps against the
// test database (ADR 0003).

// The steps this feature registers, captured instead of the identity registry (whose coverage test,
// src/features/identity/merge/coverage.test.ts, checks every model has one).
const registered = vi.hoisted(() => [] as MergeStep[]);
vi.mock("@/features/identity", () => ({
  registerMergeStep: (step: MergeStep) => void registered.push(step),
}));

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const MODELS = ["CharStatDaily", "BigramStatDaily"] as const;

describe("race host merge step (ADR 0027)", () => {
  beforeAll(async () => {
    await import("./merge-steps");
  });

  it("moves the races the guest hosted to the account", async () => {
    const step = registered.filter((s) => s.model === "Race");
    expect(step).toHaveLength(1);
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const moved = await step[0]!.run({ race: { updateMany } } as never, "g-1", "a-1", {
      afterCommit: () => {},
      onRollback: () => {},
    });
    expect(moved).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { hostUserId: "g-1" },
      data: { hostUserId: "a-1" },
    });
  });
});

describe.skipIf(!testDatabaseUrl)("per-key stats merge steps (needs TEST_DATABASE_URL)", () => {
  const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
  const PREFIX = "test-merge-stats-";
  let guestId: string;
  let accountId: string;

  const cleanup = () => db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });

  beforeAll(async () => {
    await import("./merge-steps");
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

  /** Runs the registered step of each per-key model in one transaction; the moved counts. */
  const runSteps = () =>
    db.$transaction(async (tx) => {
      const out: Record<string, number> = {};
      for (const model of MODELS) {
        const step = registered.find((s) => s.model === model);
        expect(step, `no merge step for ${model}`).toBeDefined();
        out[model] = await step!.run(tx as never, guestId, accountId, {
          afterCommit: () => {},
          onRollback: () => {},
        });
      }
      return out;
    });

  it("registers exactly one step per per-key model", () => {
    for (const model of MODELS) {
      expect(registered.filter((s) => s.model === model)).toHaveLength(1);
    }
  });

  it("an empty guest moves nothing and leaves the account's rows alone", async () => {
    await db.charStatDaily.create({
      data: {
        userId: accountId,
        day: day("2026-11-16"),
        char: "a",
        layout: "CSA",
        hits: 1,
        errors: 0,
        timedHits: 1,
        totalMs: 100,
      },
    });
    expect(await runSteps()).toEqual({ CharStatDaily: 0, BigramStatDaily: 0 });
    expect(await db.charStatDaily.count({ where: { userId: accountId } })).toBe(1);
  });

  it("disjoint rows move to the account as they are", async () => {
    await db.charStatDaily.create({
      data: {
        userId: guestId,
        day: day("2026-11-15"),
        char: "é",
        layout: "FR_CA",
        hits: 5,
        errors: 1,
        timedHits: 4,
        totalMs: 800,
      },
    });
    await db.bigramStatDaily.create({
      data: {
        userId: guestId,
        day: day("2026-11-15"),
        pair: "qu",
        hits: 3,
        errors: 0,
        timedHits: 3,
        totalMs: 420,
      },
    });
    expect(await runSteps()).toEqual({ CharStatDaily: 1, BigramStatDaily: 1 });
    expect(await db.charStatDaily.count({ where: { userId: guestId } })).toBe(0);
    expect(await db.bigramStatDaily.count({ where: { userId: guestId } })).toBe(0);
    expect(
      await db.charStatDaily.findMany({
        where: { userId: accountId },
        select: { char: true, hits: true, errors: true, timedHits: true, totalMs: true },
      }),
    ).toEqual([{ char: "é", hits: 5, errors: 1, timedHits: 4, totalMs: 800 }]);
    expect(
      await db.bigramStatDaily.findMany({
        where: { userId: accountId },
        select: { pair: true, hits: true, errors: true, timedHits: true, totalMs: true },
      }),
    ).toEqual([{ pair: "qu", hits: 3, errors: 0, timedHits: 3, totalMs: 420 }]);
  });

  it("a clashing key adds the four counts and the guest row goes", async () => {
    const charKey = { day: day("2026-11-16"), char: "t", layout: "US_QWERTY" as const };
    const pairKey = { day: day("2026-11-16"), pair: "th" };
    await db.charStatDaily.createMany({
      data: [
        { userId: accountId, ...charKey, hits: 10, errors: 2, timedHits: 9, totalMs: 1_500 },
        { userId: guestId, ...charKey, hits: 4, errors: 1, timedHits: 3, totalMs: 600 },
        // same char, other layout: its own key, moves as is
        {
          userId: guestId,
          ...charKey,
          layout: "CSA",
          hits: 1,
          errors: 0,
          timedHits: 1,
          totalMs: 90,
        },
      ],
    });
    await db.bigramStatDaily.createMany({
      data: [
        { userId: accountId, ...pairKey, hits: 7, errors: 0, timedHits: 7, totalMs: 700 },
        { userId: guestId, ...pairKey, hits: 2, errors: 1, timedHits: 1, totalMs: 150 },
      ],
    });

    expect(await runSteps()).toEqual({ CharStatDaily: 2, BigramStatDaily: 1 });

    expect(await db.charStatDaily.count({ where: { userId: guestId } })).toBe(0);
    expect(await db.bigramStatDaily.count({ where: { userId: guestId } })).toBe(0);
    const chars = await db.charStatDaily.findMany({
      where: { userId: accountId },
      orderBy: { layout: "asc" },
      select: { layout: true, hits: true, errors: true, timedHits: true, totalMs: true },
    });
    expect(chars).toEqual([
      { layout: "CSA", hits: 1, errors: 0, timedHits: 1, totalMs: 90 },
      { layout: "US_QWERTY", hits: 14, errors: 3, timedHits: 12, totalMs: 2_100 },
    ]);
    expect(
      await db.bigramStatDaily.findMany({
        where: { userId: accountId },
        select: { pair: true, hits: true, errors: true, timedHits: true, totalMs: true },
      }),
    ).toEqual([{ pair: "th", hits: 9, errors: 1, timedHits: 8, totalMs: 850 }]);
  });
});
