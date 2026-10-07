import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/server/db-client";
import { FsAvatarStore } from "../avatars/fs-store";
import { heuristicModerator } from "../avatars/moderation/heuristic";

// ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { oauthAvatarUsers } = await import("./oauth-avatar-users");
const { importOauthAvatar } = await import("../avatars/import-oauth-avatar");

const GITHUB = "https://avatars.githubusercontent.com/u/123?v=4";

// The real Prisma port of importOauthAvatar (#52 C1, C3): the conditional write is a SQL
// predicate, so the race guard is only proven against Postgres.
describe.skipIf(!testDatabaseUrl)(
  "oauthAvatarUsers (integration, needs TEST_DATABASE_URL)",
  { timeout: 15_000 },
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    let root: string;
    const created: string[] = [];

    const newUser = async (avatarKey: string | null = null) => {
      const user = await db.user.create({
        data: { typistName: `oauth-avatar-${randomUUID()}`, avatarKey },
      });
      created.push(user.id);
      return user.id;
    };
    const row = (id: string) =>
      db.user.findUniqueOrThrow({ where: { id }, select: { avatarKey: true, avatarStatus: true } });
    const image = async () =>
      new Response(
        await sharp({
          create: { width: 300, height: 200, channels: 3, background: { r: 20, g: 90, b: 200 } },
        })
          .png()
          .toBuffer(),
        { headers: { "content-type": "image/png" } },
      );

    beforeAll(async () => {
      db = createPrismaClient(testDatabaseUrl!);
      await db.$connect();
      state.db = db;
    }, 30_000);
    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "fc-oauth-avatar-db-"));
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });
    afterAll(async () => {
      await db.user.deleteMany({ where: { id: { in: created } } });
      await db.$disconnect();
    });

    it("hasAvatar reflects the stored key", async () => {
      expect(await oauthAvatarUsers.hasAvatar(await newUser())).toBe(false);
      expect(await oauthAvatarUsers.hasAvatar(await newUser("x/1"))).toBe(true);
    });

    it("C3: setAvatarIfNone writes only while avatarKey is null", async () => {
      const id = await newUser();
      expect(
        await oauthAvatarUsers.setAvatarIfNone(id, { key: `${id}/1`, status: "APPROVED" }),
      ).toBe(true);
      expect(
        await oauthAvatarUsers.setAvatarIfNone(id, { key: `${id}/2`, status: "PENDING" }),
      ).toBe(false);
      expect(await row(id)).toEqual({ avatarKey: `${id}/1`, avatarStatus: "APPROVED" });
    });

    it("C1: importOauthAvatar with the default port persists the key and status", async () => {
      const id = await newUser();
      const result = await importOauthAvatar(id, GITHUB, {
        fetch: vi.fn(image),
        store: new FsAvatarStore(root),
        warn: vi.fn(),
        // The real heuristic, injected: the env-selected default would need the full app env.
        moderator: heuristicModerator,
        now: () => 1_700_000_000_000,
      });
      expect(result).toEqual({ imported: true, key: `${id}/1700000000000` });
      expect(await row(id)).toEqual({ avatarKey: `${id}/1700000000000`, avatarStatus: "APPROVED" });
    });

    it("C3 race: a key written during the import wins; the row and its files are untouched", async () => {
      const id = await newUser();
      const store = new FsAvatarStore(root);
      const fetch = vi.fn(async () => {
        // The user's own upload commits between the has-avatar check and the import's commit.
        await store.put(id, 1_650_000_000_000, {
          256: Buffer.from("chosen-256"),
          64: Buffer.from("chosen-64"),
        });
        await db.user.update({
          where: { id },
          data: { avatarKey: `${id}/1650000000000`, avatarStatus: "APPROVED" },
        });
        return image();
      });
      const result = await importOauthAvatar(id, GITHUB, {
        fetch,
        store,
        warn: vi.fn(),
        // The real heuristic, injected: the env-selected default would need the full app env.
        moderator: heuristicModerator,
        now: () => 1_700_000_000_000,
      });
      expect(result).toEqual({ imported: false, reason: "raced" });
      expect(await row(id)).toEqual({ avatarKey: `${id}/1650000000000`, avatarStatus: "APPROVED" });
      expect((await readdir(path.join(root, id))).sort()).toEqual([
        "1650000000000-256.webp",
        "1650000000000-64.webp",
      ]);
    });
  },
);
