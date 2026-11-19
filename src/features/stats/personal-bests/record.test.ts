import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { createRace, requestOf, type FilingDesk, type FilingRace } from "../testing/filing";
import { getPersonalBests } from "./query";
import { recordPersonalBests } from "./record";

// The results index pulls in auth, which validates env at import (as get-profile.test.ts).
vi.mock("@/env", () => ({
  env: { NODE_ENV: "test", AUTH_SECRET: "m".repeat(32), RACE_TOKEN_SECRET: "r".repeat(32) },
}));
const { persistRaceResults } = await import("@/features/results");

// #999 C41: race-end persistence consumes the shared rule; flagged results excluded; clean WPM
// (ADR 0016); the query reads the viewer's own bests only.

describe("getPersonalBests (stand-in client)", () => {
  it("a visitor has none and sends no query; a viewer reads only their own rows, fastest first", async () => {
    const findMany = vi.fn(async () => []);
    expect(await getPersonalBests(null, { db: { personalBest: { findMany } } as never })).toEqual(
      [],
    );
    expect(findMany).not.toHaveBeenCalled();
    await getPersonalBests({ id: "me" }, { db: { personalBest: { findMany } } as never });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "me" },
        orderBy: [{ cleanWpm: "desc" }, { achievedAt: "asc" }],
      }),
    );
  });
});

// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("recordPersonalBests (needs TEST_DATABASE_URL)", () => {
  const db = createPrismaClient(testDatabaseUrl ?? "postgresql://unused");
  const PREFIX = "test-pb-";
  const raceIds: string[] = [];

  const cleanup = async () => {
    await db.race.deleteMany({ where: { id: { in: raceIds.splice(0) } } });
    await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
  };
  const user = async (name: string) =>
    (await db.user.create({ data: { typistName: `${PREFIX}${name}-${Date.now()}` } })).id;
  const file = async (desks: FilingDesk[], race: FilingRace = {}) => {
    const id = await createRace(db, race);
    raceIds.push(id);
    const out = await persistRaceResults(requestOf(id, desks), {
      db: db as never,
      afterSave: [recordPersonalBests],
    });
    expect(out.ok).toBe(true);
    return id;
  };
  const bests = (id: string) => getPersonalBests({ id }, { db: db as never });

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("a first counted result sets the best of its key; a slower one keeps it; a faster one raises it", async () => {
    const me = await user("me");
    const first = await file([{ userId: me, cleanWpm: 40, accuracy: 0.9 }]);
    await file([{ userId: me, cleanWpm: 35 }]);
    expect(await bests(me)).toEqual([
      expect.objectContaining({
        language: "FR",
        textType: "SENTENCES",
        length: "SHORT",
        cleanWpm: 40,
        accuracy: 0.9,
        raceId: first,
      }),
    ]);
    const faster = await file([{ userId: me, cleanWpm: 48.5 }]);
    expect(await bests(me)).toEqual([expect.objectContaining({ cleanWpm: 48.5, raceId: faster })]);
  });

  it("keys by language, text type and length: each keeps its own best", async () => {
    const me = await user("me");
    await file([{ userId: me, cleanWpm: 40 }], { language: "FR", wordCount: 20 });
    await file([{ userId: me, cleanWpm: 30 }], { language: "EN", wordCount: 20 });
    await file([{ userId: me, cleanWpm: 20 }], { language: "FR", wordCount: 70 });
    await file([{ userId: me, cleanWpm: 10 }], { language: "FR", textType: "words" });
    const rows = await bests(me);
    expect(rows.map((r) => [r.language, r.textType, r.length, r.cleanWpm])).toEqual([
      ["FR", "SENTENCES", "SHORT", 40],
      ["EN", "SENTENCES", "SHORT", 30],
      ["FR", "SENTENCES", "LONG", 20],
      ["FR", "WORDS", "SHORT", 10],
    ]);
  });

  it("never from a flagged result, a bot desk or a desk that did not count; others' bests are not the viewer's", async () => {
    const me = await user("me");
    const other = await user("other");
    await file([
      { userId: me, cleanWpm: 150, flagged: true },
      { userId: other, cleanWpm: 33 },
      { userId: null, cleanWpm: 200 },
    ]);
    await file([{ userId: me, cleanWpm: 90, status: "abandoned" }]);
    expect(await bests(me)).toEqual([]);
    expect((await bests(other)).map((r) => r.cleanWpm)).toEqual([33]);
  });

  it("a repeated filing is a no-op", async () => {
    const me = await user("me");
    const desks = [{ userId: me, cleanWpm: 42 }];
    const raceId = await file(desks);
    const before = await bests(me);
    await persistRaceResults(requestOf(raceId, desks), {
      db: db as never,
      afterSave: [recordPersonalBests],
    });
    expect(await bests(me)).toEqual(before);
  });
});
