import { beforeEach, describe, expect, it, vi } from "vitest";

// #87 C8: sign-out revokes every device (human decision 2026-10-04, ADR 0009 amendment): the account's
// `tokenVersion` is bumped before Auth.js deletes the cookie, so a session cookie captured before
// sign-out no longer resolves anywhere (`accountViewer` compares versions: src/server/auth/jwt.test.ts).
const s = vi.hoisted(() => ({
  viewer: null as null | { id: string; isGuest: boolean },
  calls: [] as string[],
  updates: [] as unknown[],
  updateFails: false,
}));

vi.mock("@/server/auth", () => ({
  getViewer: async () => s.viewer,
  signOut: async (opts: unknown) => void s.calls.push(`authSignOut:${JSON.stringify(opts)}`),
}));
vi.mock("@/server/db", () => ({
  db: {
    user: {
      updateMany: async (args: unknown) => {
        s.calls.push("bump");
        s.updates.push(args);
        if (s.updateFails) throw new Error("db down");
        return { count: 1 };
      },
    },
  },
}));
vi.mock("@/server/logger", () => ({
  logger: { warn: (msg: string) => void s.calls.push(`warn:${msg}`) },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    s.calls.push(`redirect:${url}`);
    throw new Error("NEXT_REDIRECT");
  },
}));

const { signOut } = await import("./sign-out");

describe("signOut (#87 C8)", () => {
  beforeEach(() => {
    s.viewer = null;
    s.calls = [];
    s.updates = [];
    s.updateFails = false;
  });

  it("bumps the account's tokenVersion, then deletes the cookie and lands on /", async () => {
    s.viewer = { id: "acc-1", isGuest: false };
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
    expect(s.calls).toEqual(["bump", 'authSignOut:{"redirect":false}', "redirect:/"]);
    expect(s.updates).toEqual([
      { where: { id: "acc-1", isGuest: false }, data: { tokenVersion: { increment: 1 } } },
    ]);
  });

  it("touches no row for a guest or a signed-out request", async () => {
    for (const viewer of [null, { id: "g-1", isGuest: true }]) {
      s.viewer = viewer;
      s.calls = [];
      await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
      expect(s.calls).toEqual(['authSignOut:{"redirect":false}', "redirect:/"]);
    }
  });

  it("still deletes the cookie when the bump fails, and logs by name only", async () => {
    s.viewer = { id: "acc-1", isGuest: false };
    s.updateFails = true;
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
    expect(s.calls).toEqual([
      "bump",
      "warn:sign-out revoke failed",
      'authSignOut:{"redirect":false}',
      "redirect:/",
    ]);
  });
});
