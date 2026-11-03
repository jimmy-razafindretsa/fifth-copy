import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeUsername } from "@/lib/username";
import { verifyCredentials } from "./credentials";
import { DUMMY_HASH, hashPassword } from "./password";

// The DB is a stub: rows are keyed by usernameNormalized, exactly as the unique index is.
const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({ db: { user: { findUnique } } }));

type Row = { id: string; typistName: string; isGuest: boolean; passwordHash: string | null };
const rows = new Map<string, Row>();
const PASSWORD = "correct horse battery";

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  rows.set("ada", { id: "u-ada", typistName: "Ada-101", isGuest: false, passwordHash });
  rows.set("sparrow-482", {
    id: "u-guest",
    typistName: "Sparrow-482",
    isGuest: true,
    passwordHash,
  });
  rows.set("oauth-only", { id: "u-oauth", typistName: "Gh-7", isGuest: false, passwordHash: null });
});

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockImplementation(
    async ({ where }: { where: { usernameNormalized: string } }) =>
      rows.get(where.usernameNormalized) ?? null,
  );
});

describe("verifyCredentials (C4)", () => {
  it.each(["Ada", "ada", " ADA "])(
    "returns the account for %j and the right password",
    async (username) => {
      await expect(verifyCredentials({ username, password: PASSWORD })).resolves.toEqual({
        id: "u-ada",
        name: "Ada-101",
      });
    },
  );

  it("looks the account up by usernameNormalized only, selecting no more than it needs", async () => {
    await verifyCredentials({ username: " ADA ", password: PASSWORD });
    expect(findUnique).toHaveBeenCalledWith({
      where: { usernameNormalized: normalizeUsername(" ADA ") },
      select: { id: true, typistName: true, isGuest: true, passwordHash: true },
    });
  });

  it.each([
    ["a wrong password", "ada", "correct horse battery!"],
    ["an unknown username", "grace", PASSWORD],
    ["a guest row", "Sparrow-482", PASSWORD],
    ["an account without a password", "oauth-only", PASSWORD],
    ["an empty password", "ada", ""],
    ["an empty username", "  ", PASSWORD],
  ])("returns null for %s", async (_, username, password) => {
    await expect(verifyCredentials({ username, password })).resolves.toBeNull();
  });

  it.each([null, undefined, {}, { username: "ada" }, { username: 1, password: PASSWORD }, "ada"])(
    "returns null for malformed input %j",
    async (input) => {
      await expect(verifyCredentials(input)).resolves.toBeNull();
    },
  );
});

describe("constant-shaped time (C5)", () => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const time = async (username: string) => {
    const start = performance.now();
    await verifyCredentials({ username, password: "a wrong password" });
    return performance.now() - start;
  };

  it("runs one Argon2id comparison on the unknown-username path too", async () => {
    await time("ada");
    await time("grace");
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 20; i++) {
      known.push(await time("ada"));
      unknown.push(await time("grace"));
    }
    const [a, b] = [median(known), median(unknown)];
    expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(2);
  }, 60_000);

  it("compares against a dummy hash with the same cost as a real one", async () => {
    const params = (phc: string) => phc.split("$").slice(1, 4).join("$");
    expect(params(DUMMY_HASH)).toBe(params(await hashPassword("x")));
  });
});

describe("no secret leaks (C6)", () => {
  it("fails a lookup error with an error that carries neither the password nor the hash", async () => {
    const hash = rows.get("ada")!.passwordHash!;
    findUnique.mockRejectedValueOnce(new Error(`db down ${hash} ${PASSWORD}`));
    const error: unknown = await verifyCredentials({ username: "ada", password: PASSWORD }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    for (const text of [(error as Error).message, JSON.stringify(error), String(error)]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(hash);
    }
  });
});
