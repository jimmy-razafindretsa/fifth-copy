import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdapterUser } from "next-auth/adapters";
import { createPrismaClient } from "@/server/db-client";
import { createAuthAdapter, Unsupported } from "./adapter";
import { createTypistNameFor } from "./typist-name";

// #786 C2. ADR 0003: DB-backed tests target the test database, not the app env.
// eslint-disable-next-line no-restricted-properties
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** What Auth.js hands createUser for an OAuth profile (an email included, which must be dropped). */
const profile = (name: string) =>
  ({
    id: "ignored-by-the-adapter",
    name,
    email: `${name}@example.test`,
    emailVerified: null,
    image: "https://avatars.example.test/1",
  }) as AdapterUser;

describe.skipIf(!testDatabaseUrl)("Auth.js adapter (needs TEST_DATABASE_URL, run scripts/test-db.sh)", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let adapter: ReturnType<typeof createAuthAdapter>;
  const PREFIX = `test-adapter-${randomBytes(3).toString("hex")}-`;

  const cleanup = () => db.user.deleteMany({ where: { typistName: { startsWith: PREFIX } } });

  beforeAll(() => {
    db = createPrismaClient(testDatabaseUrl!);
    adapter = createAuthAdapter({ db, typistNameFor: createTypistNameFor(db) });
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  describe("createUser", () => {
    it("persists an account row (isGuest=false) under the profile name, with no email", async () => {
      const created = await adapter.createUser!(profile(`${PREFIX}ada`));
      expect(created).toEqual({ id: expect.any(String), name: `${PREFIX}ada`, tokenVersion: 0 });
      expect(created).not.toHaveProperty("email");
      expect(created.id).not.toBe("ignored-by-the-adapter");

      const row = await db.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({ isGuest: false, typistName: `${PREFIX}ada`, tokenVersion: 0 });
      expect(row).not.toHaveProperty("email");
      expect(JSON.stringify(row)).not.toContain("example.test");
    });

    it("gives a taken name a 3-digit suffix, so typistName stays unique", async () => {
      const first = await adapter.createUser!(profile(`${PREFIX}bo`));
      const second = await adapter.createUser!(profile(`${PREFIX}bo`));
      expect(first.name).toBe(`${PREFIX}bo`);
      expect(second.name).toMatch(new RegExp(`^${PREFIX}bo-\\d{3}$`));
      expect(second.id).not.toBe(first.id);
    });
  });

  describe("unsupported methods", () => {
    it.each([
      ["getUserByEmail", () => adapter.getUserByEmail!("a@example.test")],
      [
        "createSession",
        () => adapter.createSession!({ sessionToken: "t", userId: "u", expires: new Date() }),
      ],
      ["getSessionAndUser", () => adapter.getSessionAndUser!("t")],
      ["updateSession", () => adapter.updateSession!({ sessionToken: "t" })],
      ["deleteSession", () => adapter.deleteSession!("t")],
      [
        "createVerificationToken",
        () =>
          adapter.createVerificationToken!({
            identifier: "a@example.test",
            token: "t",
            expires: new Date(),
          }),
      ],
      [
        "useVerificationToken",
        () => adapter.useVerificationToken!({ identifier: "a@example.test", token: "t" }),
      ],
    ])("%s throws Unsupported", async (_name, call) => {
      await expect((async () => call())()).rejects.toBeInstanceOf(Unsupported);
    });
  });

  describe("OAuth accounts", () => {
    it("linkAccount writes one GITHUB row; getUserByAccount finds it, null for an unknown pair", async () => {
      const user = await adapter.createUser!(profile(`${PREFIX}cy`));
      const providerAccountId = `gh-${randomBytes(4).toString("hex")}`;
      await adapter.linkAccount!({
        userId: user.id,
        type: "oauth",
        provider: "github",
        providerAccountId,
        access_token: "never-stored",
      });

      const rows = await db.oAuthAccount.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provider: "GITHUB", providerAccountId });

      await expect(adapter.getUserByAccount!({ provider: "github", providerAccountId })).resolves.toEqual(
        { id: user.id, name: `${PREFIX}cy`, tokenVersion: 0 },
      );
      await expect(
        adapter.getUserByAccount!({ provider: "github", providerAccountId: "gh-unknown" }),
      ).resolves.toBeNull();
      await expect(
        adapter.getUserByAccount!({ provider: "discord", providerAccountId }),
      ).resolves.toBeNull();
      await expect(
        adapter.getUserByAccount!({ provider: "credentials", providerAccountId }),
      ).resolves.toBeNull();
    });

    it("refuses a provider outside OAuthProvider", async () => {
      const user = await adapter.createUser!(profile(`${PREFIX}dee`));
      await expect(
        (async () =>
          adapter.linkAccount!({
            userId: user.id,
            type: "oauth",
            provider: "google",
            providerAccountId: "g-1",
          }))(),
      ).rejects.toBeInstanceOf(Unsupported);
      await expect(db.oAuthAccount.count({ where: { userId: user.id } })).resolves.toBe(0);
    });
  });

  describe("getUser and updateUser", () => {
    it("getUser returns the account and null for unknown ids and guest rows", async () => {
      const user = await adapter.createUser!(profile(`${PREFIX}eve`));
      await expect(adapter.getUser!(user.id)).resolves.toEqual(user);
      await expect(adapter.getUser!("no-such-id")).resolves.toBeNull();
      const guest = await db.user.create({ data: { isGuest: true, typistName: `${PREFIX}guest` } });
      await expect(adapter.getUser!(guest.id)).resolves.toBeNull();
    });

    it("updateUser never writes provider data (name, email, image) onto the row", async () => {
      const user = await adapter.createUser!(profile(`${PREFIX}fay`));
      const updated = await adapter.updateUser!({
        id: user.id,
        name: "renamed by provider",
        email: "fay@example.test",
        emailVerified: new Date(),
        image: "https://avatars.example.test/2",
      });
      expect(updated).toEqual(user);
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.typistName).toBe(`${PREFIX}fay`);
      expect(row.avatarKey).toBeNull();
    });
  });
});
