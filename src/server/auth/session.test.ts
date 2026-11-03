import { randomBytes } from "node:crypto";
import { decode, encode } from "next-auth/jwt";
import { describe, expect, it, vi } from "vitest";
import { type AccountRow, createSessionResolver, type SessionClaims } from "./session";

// #787 C1, C3, C5: the Auth.js session resolver, over injected dependencies (no DB, no Next).
const account: AccountRow = {
  typistName: "Ada-0042",
  isGuest: false,
  tokenVersion: 3,
  avatarStatus: "APPROVED",
};
const session = (id: string, tokenVersion: number): SessionClaims => ({
  user: { id, name: "stale name from the JWT", tokenVersion },
});

function setup(claims: SessionClaims | null, row: AccountRow | null = account) {
  const getSession = vi.fn(async () => claims);
  const findAccountById = vi.fn(async (_id: string) => (row ? { ...row } : null));
  return {
    resolve: createSessionResolver({ getSession, findAccountById }),
    getSession,
    findAccountById,
  };
}

describe("createSessionResolver (C1)", () => {
  it("returns the account viewer when the session's tokenVersion equals the row's", async () => {
    const { resolve, findAccountById } = setup(session("u1", 3));
    await expect(resolve()).resolves.toEqual({
      id: "u1",
      name: "Ada-0042",
      isGuest: false,
      hasAvatar: true,
    });
    expect(findAccountById).toHaveBeenCalledWith("u1");
  });

  it("takes the name from the row, not the JWT, and hasAvatar only for APPROVED", async () => {
    for (const avatarStatus of ["NONE", "PENDING", "REJECTED"] as const) {
      const { resolve } = setup(session("u1", 3), { ...account, avatarStatus });
      await expect(resolve()).resolves.toMatchObject({ name: "Ada-0042", hasAvatar: false });
    }
  });

  it("returns null when there is no session", async () => {
    await expect(setup(null).resolve()).resolves.toBeNull();
  });

  it("returns null when the row is missing", async () => {
    await expect(setup(session("gone", 3), null).resolve()).resolves.toBeNull();
  });

  it("returns null when the row is a guest", async () => {
    const { resolve } = setup(session("u1", 3), { ...account, isGuest: true });
    await expect(resolve()).resolves.toBeNull();
  });

  it("returns null when the versions differ, either way", async () => {
    await expect(setup(session("u1", 2)).resolve()).resolves.toBeNull();
    await expect(setup(session("u1", 4)).resolve()).resolves.toBeNull();
  });

  it("returns null for a session without a usable id or tokenVersion, without a read", async () => {
    const malformed: unknown[] = [
      {},
      { user: {} },
      { user: { id: "", tokenVersion: 3 } },
      { user: { id: "u1" } },
      { user: { id: "u1", tokenVersion: "3" } },
      { user: { id: "u1", tokenVersion: 1.5 } },
    ];
    for (const claims of malformed) {
      const { resolve, findAccountById } = setup(claims as SessionClaims);
      await expect(resolve()).resolves.toBeNull();
      expect(findAccountById).not.toHaveBeenCalled();
    }
  });

  it("never writes: its only dependencies are a session read and a row read", async () => {
    const { resolve, getSession, findAccountById } = setup(session("u1", 3));
    await resolve();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(findAccountById).toHaveBeenCalledTimes(1);
    // The resolver gets no db, no cookie jar and no writer: nothing else exists for it to call.
    expect(createSessionResolver.length).toBe(1);
  });
});

describe("tokenVersion revocation (C3)", () => {
  const secret = randomBytes(32).toString("hex");
  const salt = "authjs.session-token";

  it("a JWT minted with tokenVersion n resolves until User.tokenVersion becomes n + 1", async () => {
    const n = 5;
    const jwt = await encode({
      token: { sub: "u1", name: "Ada-0042", tokenVersion: n },
      secret,
      salt,
    });
    const row: AccountRow = { ...account, tokenVersion: n };
    // getSession decodes the cookie the way Auth.js does, then maps it like the session callback.
    const resolve = createSessionResolver({
      getSession: async () => {
        const token = await decode({ token: jwt, secret, salt });
        return token ? { user: { id: token.sub ?? "", tokenVersion: token.tokenVersion } } : null;
      },
      findAccountById: async (id) => (id === "u1" ? { ...row } : null),
    });

    await expect(resolve()).resolves.toMatchObject({ id: "u1", isGuest: false });
    row.tokenVersion = n + 1; // UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1
    await expect(resolve()).resolves.toBeNull();
  });
});

describe("database reads (C5)", () => {
  it("reads the row exactly once per resolution", async () => {
    const { resolve, findAccountById } = setup(session("u1", 3));
    await resolve();
    expect(findAccountById).toHaveBeenCalledTimes(1);
  });

  it("reads nothing when there is no session cookie", async () => {
    const { resolve, findAccountById } = setup(null);
    await resolve();
    expect(findAccountById).not.toHaveBeenCalled();
  });
});
