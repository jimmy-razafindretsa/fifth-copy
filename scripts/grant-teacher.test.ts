import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../src/server/db-client";
import { main, type GrantTeacherDeps } from "./grant-teacher";

// #788 C8: the one writer of `User.isTeacher`, run by the owner out of band.
// ADR 0003: DB-backed tests target the test database, not the app env.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const SECRET_URL = "postgresql://u:hunter2@localhost:5432/app";

type Io = { out: string[]; err: string[] };
function deps(overrides: Partial<GrantTeacherDeps> = {}): GrantTeacherDeps & Io {
  const io: Io = { out: [], err: [] };
  return {
    ...io,
    databaseUrl: SECRET_URL,
    guard: vi.fn(() => true),
    connect: vi.fn(() => {
      throw new Error("must not connect");
    }),
    print: (line: string) => void io.out.push(line),
    printError: (line: string) => void io.err.push(line),
    ...overrides,
  };
}

describe("grant-teacher CLI guards", () => {
  it("refuses without exactly one username, before touching the database", async () => {
    for (const argv of [[], ["a", "b"]]) {
      const d = deps();
      expect(await main(argv, d)).toBe(2);
      expect(d.connect).not.toHaveBeenCalled();
      expect(d.err.join("\n")).toMatch(/usage/);
    }
  });

  it("refuses without DATABASE_URL", async () => {
    const d = deps({ databaseUrl: undefined });
    expect(await main(["ada"], d)).toBe(2);
    expect(d.connect).not.toHaveBeenCalled();
  });

  it("stops when the DB guard refuses the URL, and never prints it", async () => {
    const d = deps({ guard: vi.fn(() => false) });
    expect(await main(["ada"], d)).toBe(1);
    expect(d.connect).not.toHaveBeenCalled();
    expect([...d.out, ...d.err].join("\n")).not.toContain("hunter2");
  });
});

describe.skipIf(!testDatabaseUrl)("grant-teacher (needs TEST_DATABASE_URL)", () => {
  const prefix = `test-teacher-${randomUUID().slice(0, 8)}-`;
  let db: ReturnType<typeof createPrismaClient>;
  const live = () => deps({ databaseUrl: testDatabaseUrl, connect: createPrismaClient });

  beforeAll(async () => {
    db = createPrismaClient(testDatabaseUrl!);
    await db.user.create({
      data: {
        typistName: `${prefix}Teach`,
        isGuest: false,
        username: `${prefix}Teach`,
        usernameNormalized: `${prefix}teach`,
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$x$y",
      },
    });
    await db.user.create({
      data: {
        typistName: `${prefix}Guest`,
        isGuest: true,
        username: `${prefix}Guest`,
        usernameNormalized: `${prefix}guest`,
      },
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { typistName: { startsWith: prefix } } });
    await db.$disconnect();
  });

  const flag = async (key: string) =>
    (await db.user.findUniqueOrThrow({ where: { usernameNormalized: `${prefix}${key}` } }))
      .isTeacher;

  it("flags an account (username matched case-insensitively) and prints only its id", async () => {
    const d = live();
    expect(await main([`${prefix}TEACH`], d)).toBe(0);
    expect(await flag("teach")).toBe(true);
    const row = await db.user.findUniqueOrThrow({
      where: { usernameNormalized: `${prefix}teach` },
    });
    expect(d.out).toEqual([`${row.id} teacher`]);
    expect([...d.out, ...d.err].join("\n")).not.toMatch(/argon2|postgresql/);
  });

  it("refuses a guest and leaves it unflagged", async () => {
    const d = live();
    expect(await main([`${prefix}Guest`], d)).toBe(1);
    expect(await flag("guest")).toBe(false);
    expect(d.err.join("\n")).toMatch(/guest/);
  });

  it("refuses an unknown username", async () => {
    const d = live();
    expect(await main([`${prefix}nobody`], d)).toBe(1);
    expect(d.out).toEqual([]);
  });
});
