import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../src/server/db-client";
import { TYPIST_WORDS } from "../src/features/identity/guest/names";
import { normalizeUsername } from "../src/features/identity/schema";
import { main, type RenameDeps } from "./rename-user";

// ADR 0003: DB-backed tests target the test database, not the app env.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const REMOTE = "postgresql://u:hunter2@db.prod.example.com:5432/app";
// A cold tsx start under load takes seconds (#600); a hung child fails with its own error below
// the slow project's per-test timeout (vitest.config.ts).
const SPAWN_TIMEOUT = 30_000;
const tsx = (args: string[], env: Record<string, string>) => {
  const r = spawnSync(TSX, args, { cwd: ROOT, env, encoding: "utf8", timeout: SPAWN_TIMEOUT });
  if (r.error) throw r.error;
  return r;
};

type Io = { out: string[]; err: string[] };
function deps(overrides: Partial<RenameDeps> = {}): RenameDeps & Io {
  const io: Io = { out: [], err: [] };
  return {
    ...io,
    databaseUrl: "postgresql://u:p@localhost:5432/app",
    guard: vi.fn(() => true),
    connect: vi.fn(() => {
      throw new Error("must not connect");
    }),
    rng: Math.random,
    print: (line: string) => void io.out.push(line),
    printError: (line: string) => void io.err.push(line),
    ...overrides,
  };
}

describe("rename-user CLI guards", () => {
  it("refuses without --yes, before touching the database", async () => {
    const d = deps();
    expect(await main(["Sparrow-482"], d)).not.toBe(0);
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.out).toEqual([]);
    expect(d.err.join("\n")).toMatch(/--yes/);
  });

  it("refuses without a target", async () => {
    const d = deps();
    expect(await main(["--yes"], d)).not.toBe(0);
    expect(d.connect).not.toHaveBeenCalled();
  });

  it("runs db-guard on the target URL and stops when it refuses", async () => {
    const d = deps({ databaseUrl: REMOTE, guard: vi.fn(() => false) });
    expect(await main(["Sparrow-482", "--yes"], d)).not.toBe(0);
    expect(d.guard).toHaveBeenCalledWith(REMOTE);
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.out).toEqual([]);
  });

  it("the real command refuses without --yes and prints nothing on stdout", () => {
    const r = tsx(["scripts/rename-user.ts", "Sparrow-482"], {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      DATABASE_URL: REMOTE,
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/--yes/);
  });

  it("the real command runs scripts/db-guard.sh and refuses a remote database", () => {
    const r = tsx(["scripts/rename-user.ts", "Sparrow-482", "--yes"], {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      DATABASE_URL: REMOTE,
      DB_GUARD_ALLOWED_HOSTS: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/db-guard: REFUSED/);
    expect(r.stdout + r.stderr).not.toContain("hunter2");
  });
});

describe.skipIf(!testDatabaseUrl)(
  "rename-user on the test database (needs TEST_DATABASE_URL, run scripts/test-db.sh)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const PREFIX = "test-rename-";
    const ids: string[] = [];
    const NAME_RE = /^(.+)-(\d{3,4})$/;

    const cleanup = async () => {
      await db.user.deleteMany({
        where: { OR: [{ typistName: { startsWith: PREFIX } }, { id: { in: ids.splice(0) } }] },
      });
    };
    const run = (argv: string[], overrides: Partial<RenameDeps> = {}) => {
      const d = deps({
        databaseUrl: testDatabaseUrl!,
        guard: vi.fn(() => true),
        connect: (url: string) => createPrismaClient(url),
        ...overrides,
      });
      return main(argv, d).then((code) => ({ code, out: d.out, err: d.err, guard: d.guard }));
    };
    const account = async (suffix: string) => {
      const user = await db.user.create({
        data: {
          isGuest: false,
          typistName: `${PREFIX}${suffix}`,
          username: `${PREFIX}${suffix}`.toUpperCase(),
          usernameNormalized: normalizeUsername(`${PREFIX}${suffix}`),
          passwordHash: "argon2id$fake",
          tokenVersion: 3,
          hostedLobbies: { create: { code: `TST-${Math.floor(1000 + Math.random() * 9000)}` } },
        },
      });
      ids.push(user.id);
      return user;
    };

    beforeAll(() => {
      db = createPrismaClient(testDatabaseUrl!);
    });
    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await db.$disconnect();
    });

    it("renames by username to a fresh generated name, keeps history, prints only id and name", async () => {
      const before = await account("offensive");
      const r = await run([before.username!.toLowerCase(), "--yes"]);
      expect(r.code).toBe(0);
      expect(r.guard).toHaveBeenCalledWith(testDatabaseUrl);

      const after = await db.user.findUniqueOrThrow({
        where: { id: before.id },
        include: { hostedLobbies: true },
      });
      const [, word] = NAME_RE.exec(after.typistName) ?? [];
      expect(TYPIST_WORDS).toContain(word);
      expect(after.username).toBe(after.typistName);
      expect(after.usernameNormalized).toBe(normalizeUsername(after.typistName));
      // Stats and history stay: same row, same credentials and sessions, same hosted lobbies.
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.tokenVersion).toBe(before.tokenVersion);
      expect(after.isGuest).toBe(false);
      expect(after.hostedLobbies).toHaveLength(1);

      expect(r.out).toEqual([`${before.id} ${after.typistName}`]);
      expect(r.out.join("\n") + r.err.join("\n")).not.toContain(PREFIX);
    });

    it("finds the account by id or by the name as shown", async () => {
      const a = await account("by-id");
      expect((await run([a.id, "--yes"])).code).toBe(0);
      expect((await db.user.findUniqueOrThrow({ where: { id: a.id } })).typistName).not.toBe(
        a.typistName,
      );

      const guest = await db.user.create({ data: { typistName: `${PREFIX}shown` } });
      ids.push(guest.id);
      const r = await run([guest.typistName, "--yes"]);
      expect(r.code).toBe(0);
      const renamed = await db.user.findUniqueOrThrow({ where: { id: guest.id } });
      expect(renamed.typistName).toMatch(NAME_RE);
      expect(renamed.username).toBeNull();
      expect(renamed.usernameNormalized).toBeNull();
    });

    it("draws again when the generated name is already taken (typist name or username)", async () => {
      const target = await account("collide");
      // rng 0 -> first word, suffix 100: "<first word>-100" every draw until the 4-digit fallback.
      const first = `${TYPIST_WORDS[0]}-100`;
      const holder = await db.user.findUnique({ where: { typistName: first } });
      if (!holder) {
        const h = await db.user.create({ data: { typistName: first } });
        ids.push(h.id);
      }
      const other = await db.user.create({
        data: {
          typistName: `${PREFIX}other`,
          username: `${TYPIST_WORDS[0]}-1000`,
          usernameNormalized: normalizeUsername(`${TYPIST_WORDS[0]}-1000`),
        },
      });
      ids.push(other.id);
      let calls = 0;
      // 5 three-digit draws collide on typistName; first 4-digit draw collides on username;
      // the next one (suffix 1000 + 1) is free.
      const rng = () => {
        calls++;
        return calls === 14 ? 1 / 9000 + 1e-9 : 0;
      };
      const r = await run([target.id, "--yes"], { rng });
      expect(r.code).toBe(0);
      const renamed = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(renamed.typistName).toBe(`${TYPIST_WORDS[0]}-1001`);
    });

    it("fails without printing on stdout when no account matches", async () => {
      const r = await run([`${PREFIX}nobody`, "--yes"]);
      expect(r.code).not.toBe(0);
      expect(r.out).toEqual([]);
    });
  },
);
