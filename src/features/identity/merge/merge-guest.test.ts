import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { FsAvatarStore } from "../avatars/fs-store";
import type { AvatarFiles } from "../avatars/store";

// #56 C1, C2, C4: the merge transaction against the test database (ADR 0003) and a temp avatar dir.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({ db: null as unknown, store: null as unknown }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
// CI has no AUTH_SECRET or RACE_TOKEN_SECRET: the feature indexes the steps load import @/env.
vi.mock("@/env", () => ({
  env: { NODE_ENV: "test", AUTH_SECRET: "m".repeat(32), RACE_TOKEN_SECRET: "r".repeat(32) },
}));
vi.mock("../avatars/default-store", () => ({
  avatarStore: new Proxy(
    {},
    { get: (_t, key) => (state.store as Record<PropertyKey, unknown>)[key] },
  ),
}));

const PREFIX = "test-merge-";
const FILES: AvatarFiles = { 256: Buffer.from("big"), 64: Buffer.from("small") };

describe.skipIf(!testDatabaseUrl)("mergeGuestInto (needs TEST_DATABASE_URL)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let store: FsAvatarStore;
  let dir: string;
  let merge: typeof import("./merge-guest");
  let registry: typeof import("./registry");
  let guestId: string;
  let accountId: string;
  const raceId = randomUUID();

  const cleanup = async () => {
    await db.race.deleteMany({ where: { id: raceId } });
    await db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });
  };

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    dir = await mkdtemp(path.join(tmpdir(), "merge-avatars-"));
    store = new FsAvatarStore(dir);
    state.db = db;
    state.store = store;
    merge = await import("./merge-guest");
    registry = await import("./registry");
    const { loadFeatureMergeSteps } = await import("../testing/merge-steps");
    await loadFeatureMergeSteps();
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await cleanup();
    const tag = randomUUID().slice(0, 8);
    guestId = (await db.user.create({ data: { typistName: `${PREFIX}g-${tag}` } })).id;
    accountId = (
      await db.user.create({
        data: { typistName: `${PREFIX}a-${tag}`, isGuest: false, username: `m${tag}` },
      })
    ).id;
  });

  async function seedGuestRace() {
    await db.lobby.create({ data: { code: `TST-${raceId.slice(0, 4)}`, hostUserId: guestId } });
    await db.race.create({
      data: {
        id: raceId,
        textContent: "a b",
        textLanguage: "EN",
        textWordCount: 2,
        settings: {},
        startedAt: new Date(),
        engineVersion: "test",
        protocolVersion: 1,
      },
    });
    const n = { wpm: 50, rawWpm: 50, cleanWpm: 50, adjustedWpm: 50, accuracy: 1, progress: 1 };
    await db.raceResult.create({
      data: {
        raceId,
        userId: guestId,
        desk: 1,
        name: "Guest",
        isBot: false,
        place: 1,
        status: "FINISHED",
        ...n,
        correct: 3,
        errors: 0,
        total: 3,
        durationMs: 1000,
        bonusesSent: 0,
        bonusesReceived: 0,
        bonusLog: [],
        engineVersion: "test",
      },
    });
    await db.raceKeystrokes.create({
      data: { raceId, desk: 1, userId: guestId, data: Buffer.from("x"), count: 3 },
    });
  }

  async function snapshot() {
    return {
      users: await db.user.findMany({
        where: { id: { in: [guestId, accountId] } },
        orderBy: { id: "asc" },
      }),
      prefs: await db.preference.findMany({
        where: { userId: { in: [guestId, accountId] } },
        orderBy: { userId: "asc" },
      }),
      results: await db.raceResult.findMany({ where: { raceId }, select: { userId: true } }),
      keys: await db.raceKeystrokes.findMany({ where: { raceId }, select: { userId: true } }),
      lobbies: await db.lobby.findMany({
        where: { hostUserId: { in: [guestId, accountId] } },
        select: { hostUserId: true },
      }),
    };
  }

  describe("C1 one transaction", () => {
    it("moves every row to the account, deletes the guest and returns per-model counts", async () => {
      await seedGuestRace();
      const counts = await merge.mergeGuestInto(guestId, accountId);
      expect(counts).toMatchObject({ RaceResult: 1, RaceKeystrokes: 1, Lobby: 1, Preference: 0 });
      const after = await snapshot();
      expect(after.users.map((u) => u.id)).toEqual([accountId]);
      expect(after.results).toEqual([{ userId: accountId }]);
      expect(after.keys).toEqual([{ userId: accountId }]);
      expect(after.lobbies).toEqual([{ hostUserId: accountId }]);
    });

    it("rolls everything back when a step fails", async () => {
      await seedGuestRace();
      await db.preference.create({ data: { userId: guestId, layout: "CSA" } });
      const before = await snapshot();
      const off = registry.registerMergeStep({
        model: "Lobby",
        run: async () => {
          throw new Error("step failed");
        },
      });
      try {
        await expect(merge.mergeGuestInto(guestId, accountId)).rejects.toThrow("step failed");
      } finally {
        off();
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("C2 identity steps", () => {
    it("account's non-null preferences win, else the guest's", async () => {
      await db.preference.create({
        data: { userId: guestId, layout: "CSA", locale: "FR", theme: "LIGHT", sound: false },
      });
      await db.preference.create({ data: { userId: accountId, locale: "EN", theme: "DARK" } });
      const counts = await merge.mergeGuestInto(guestId, accountId);
      expect(counts.Preference).toBe(1);
      const prefs = await db.preference.findMany({
        where: { userId: { in: [guestId, accountId] } },
      });
      expect(prefs).toHaveLength(1);
      expect(prefs[0]).toMatchObject({
        userId: accountId,
        layout: "CSA",
        locale: "EN",
        theme: "DARK",
        sound: true,
      });
    });

    it("moves the guest's preference row when the account has none", async () => {
      await db.preference.create({ data: { userId: guestId, layout: "AZERTY", theme: "LIGHT" } });
      await merge.mergeGuestInto(guestId, accountId);
      const pref = await db.preference.findUnique({ where: { userId: accountId } });
      expect(pref).toMatchObject({ layout: "AZERTY", theme: "LIGHT" });
    });

    it("moves the guest's avatar key and files when the account has none", async () => {
      await store.put(guestId, 3, FILES);
      await db.user.update({
        where: { id: guestId },
        data: { avatarKey: `${guestId}/3`, avatarStatus: "APPROVED" },
      });
      const counts = await merge.mergeGuestInto(guestId, accountId);
      expect(counts.User).toBe(1);
      const account = await db.user.findUniqueOrThrow({ where: { id: accountId } });
      expect(account).toMatchObject({ avatarKey: `${accountId}/3`, avatarStatus: "APPROVED" });
      expect(await store.get(accountId, 3, 256)).toEqual(FILES[256]);
      expect(await store.get(accountId, 3, 64)).toEqual(FILES[64]);
      expect(await store.get(guestId, 3, 256)).toBeNull();
    });

    it("keeps the account's avatar and deletes the guest's files", async () => {
      await store.put(guestId, 1, FILES);
      await store.put(accountId, 2, FILES);
      await db.user.update({
        where: { id: guestId },
        data: { avatarKey: `${guestId}/1`, avatarStatus: "APPROVED" },
      });
      await db.user.update({
        where: { id: accountId },
        data: { avatarKey: `${accountId}/2`, avatarStatus: "PENDING" },
      });
      await merge.mergeGuestInto(guestId, accountId);
      const account = await db.user.findUniqueOrThrow({ where: { id: accountId } });
      expect(account).toMatchObject({ avatarKey: `${accountId}/2`, avatarStatus: "PENDING" });
      expect(await store.get(guestId, 1, 256)).toBeNull();
      expect(await store.get(accountId, 1, 256)).toBeNull();
      expect(await store.get(accountId, 2, 256)).toEqual(FILES[256]);
    });

    it("removes the copied avatar files when the transaction rolls back", async () => {
      await store.put(guestId, 4, FILES);
      await db.user.update({
        where: { id: guestId },
        data: { avatarKey: `${guestId}/4`, avatarStatus: "APPROVED" },
      });
      const off = registry.registerMergeStep({
        model: "Lobby",
        run: async () => {
          throw new Error("late failure");
        },
      });
      try {
        await expect(merge.mergeGuestInto(guestId, accountId)).rejects.toThrow("late failure");
      } finally {
        off();
      }
      expect(await store.get(accountId, 4, 256)).toBeNull();
      expect(await store.get(guestId, 4, 256)).toEqual(FILES[256]);
      const account = await db.user.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.avatarKey).toBeNull();
    });

    it("refuses a guest that owns a sign-in link", async () => {
      await db.oAuthAccount.create({
        data: { userId: guestId, provider: "GITHUB", providerAccountId: `t-${randomUUID()}` },
      });
      await expect(merge.mergeGuestInto(guestId, accountId)).rejects.toThrow(
        "Guest owns OAuthAccount",
      );
      expect(await db.user.findUnique({ where: { id: guestId } })).not.toBeNull();
    });
  });

  describe("C4 safety", () => {
    it("refuses a non-guest source and changes nothing", async () => {
      await seedGuestRace();
      await db.user.update({ where: { id: guestId }, data: { isGuest: false } });
      const before = await snapshot();
      await expect(merge.mergeGuestInto(guestId, accountId)).rejects.toThrow("not a guest");
      expect(await snapshot()).toEqual(before);
    });

    it("refuses a guest as the target", async () => {
      await db.user.update({ where: { id: accountId }, data: { isGuest: true } });
      const before = await snapshot();
      await expect(merge.mergeGuestInto(guestId, accountId)).rejects.toThrow("not an account");
      expect(await snapshot()).toEqual(before);
    });

    it("refuses unknown ids and malformed ids", async () => {
      await seedGuestRace();
      const before = await snapshot();
      await expect(merge.mergeGuestInto("nope-guest", accountId)).rejects.toThrow("Unknown user");
      await expect(merge.mergeGuestInto(guestId, "nope-account")).rejects.toThrow("Unknown user");
      await expect(merge.mergeGuestInto("", accountId)).rejects.toThrow("Invalid user id");
      expect(await snapshot()).toEqual(before);
    });

    it("refuses the same id as source and target", async () => {
      await seedGuestRace();
      const before = await snapshot();
      await expect(merge.mergeGuestInto(guestId, guestId)).rejects.toThrow("into itself");
      expect(await snapshot()).toEqual(before);
    });

    it("refuses to merge the same guest twice", async () => {
      await seedGuestRace();
      await merge.mergeGuestInto(guestId, accountId);
      const before = await snapshot();
      await expect(merge.mergeGuestInto(guestId, accountId)).rejects.toThrow("Unknown user");
      expect(await snapshot()).toEqual(before);
    });

    it("refuses before any write when a model has no registered step", async () => {
      await seedGuestRace();
      const before = await snapshot();
      const lobby = registry.mergeSteps().find((s) => s.model === "Lobby")!;
      // Simulate a feature whose step module was never loaded: the remover deletes the first
      // occurrence of the step object, so two calls drop the original and the duplicate.
      const off = registry.registerMergeStep(lobby);
      off();
      off();
      expect(registry.mergeSteps()).not.toContain(lobby);
      try {
        await expect(merge.mergeGuestInto(guestId, accountId)).rejects.toThrow(
          "No merge step registered for: Lobby",
        );
      } finally {
        registry.registerMergeStep(lobby);
      }
      expect(await snapshot()).toEqual(before);
    });
  });
});
