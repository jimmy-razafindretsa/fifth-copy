import { describe, expect, it, vi } from "vitest";
import { createGuestResolver, type GuestCookieJar, type GuestRow } from "./guest";
import { GUEST_COOKIE, signGuestCookie } from "./guest-cookie";

const secret = "k".repeat(32);
const sparrow: GuestRow = { id: "u1", typistName: "Sparrow-482", isGuest: true, avatarStatus: "NONE" };

function jar(value?: string, { readOnly = false } = {}) {
  const store = new Map<string, string>(value === undefined ? [] : [[GUEST_COOKIE, value]]);
  return {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: vi.fn((name: string, v: string) => void store.set(name, v)),
    delete: vi.fn((name: string) => {
      if (readOnly) throw new Error("Cookies can only be modified in a Server Action or Route Handler");
      store.delete(name);
    }),
    has: (name: string) => store.has(name),
  } satisfies GuestCookieJar & { has: (n: string) => boolean };
}

function resolver(cookies: ReturnType<typeof jar>, rows: GuestRow[] = [sparrow]) {
  const findGuestById = vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null);
  const resolve = createGuestResolver({ getCookieJar: async () => cookies, findGuestById, secret });
  return { resolve, findGuestById };
}

describe("guest resolver (C3)", () => {
  it("maps a validly signed guest cookie to its Viewer", async () => {
    const { resolve } = resolver(jar(signGuestCookie("u1", secret)));
    await expect(resolve()).resolves.toEqual({
      id: "u1",
      name: "Sparrow-482",
      isGuest: true,
      hasAvatar: false,
    });
  });

  it("reports hasAvatar only for an approved avatar", async () => {
    const { resolve } = resolver(jar(signGuestCookie("u1", secret)), [
      { ...sparrow, avatarStatus: "APPROVED" },
    ]);
    await expect(resolve()).resolves.toMatchObject({ hasAvatar: true });
  });

  it("resolves nobody without a cookie and touches neither the DB nor the jar", async () => {
    const cookies = jar();
    const { resolve, findGuestById } = resolver(cookies);
    await expect(resolve()).resolves.toBeNull();
    expect(findGuestById).not.toHaveBeenCalled();
    expect(cookies.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["tampered", `u2.${signGuestCookie("u1", secret).split(".")[1]}`],
    ["unsigned", "u1"],
    ["signed with another secret", signGuestCookie("u1", "x".repeat(32))],
  ])("rejects a %s cookie without a DB lookup and clears it", async (_l, value) => {
    const cookies = jar(value);
    const { resolve, findGuestById } = resolver(cookies);
    await expect(resolve()).resolves.toBeNull();
    expect(findGuestById).not.toHaveBeenCalled();
    expect(cookies.delete).toHaveBeenCalledWith(GUEST_COOKIE);
    expect(cookies.has(GUEST_COOKIE)).toBe(false);
  });

  it("rejects a signed cookie for an unknown id and clears it", async () => {
    const cookies = jar(signGuestCookie("gone", secret));
    const { resolve } = resolver(cookies);
    await expect(resolve()).resolves.toBeNull();
    expect(cookies.delete).toHaveBeenCalledWith(GUEST_COOKIE);
  });

  it("rejects a signed cookie whose row is no longer a guest", async () => {
    const cookies = jar(signGuestCookie("u1", secret));
    const { resolve } = resolver(cookies, [{ ...sparrow, isGuest: false }]);
    await expect(resolve()).resolves.toBeNull();
    expect(cookies.delete).toHaveBeenCalledWith(GUEST_COOKIE);
  });

  it("clears best-effort: a read-only jar (Server Component render) still resolves nobody", async () => {
    const cookies = jar("u1", { readOnly: true });
    const { resolve } = resolver(cookies);
    await expect(resolve()).resolves.toBeNull();
    expect(cookies.delete).toHaveBeenCalled();
  });
});
