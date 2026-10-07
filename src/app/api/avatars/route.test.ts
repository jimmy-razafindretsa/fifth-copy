import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GUEST_COOKIE, signGuestCookie } from "@/server/auth/guest-cookie";

// C8: GET /api/avatars/[userId] through the real viewer resolution (signed guest cookie), the
// real query and the real filesystem store; only cookies, env and the User table are faked.
const SECRET = "v".repeat(32);
const VERSION = 1_700_000_000_000;
type Row = {
  id: string;
  typistName: string;
  isGuest: boolean;
  avatarKey: string | null;
  avatarStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
};

const state = vi.hoisted(() => ({ jar: new Map<string, string>(), rows: [] as Row[], dir: "" }));
state.dir = mkdtempSync(path.join(tmpdir(), "fc-avatar-route-"));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
  }),
}));
vi.mock("@/env", () => ({
  env: {
    AUTH_SECRET: "v".repeat(32),
    NODE_ENV: "test",
    get AVATAR_DIR() {
      return state.dir;
    },
  },
}));
vi.mock("@/server/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.rows.find((r) => r.id === where.id) ?? null;
      }),
    },
  },
}));

const { GET } = await import("./[userId]/route");
const { avatarStore } = await import("@/features/identity");

const row = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  typistName: `Heron-${id}`,
  isGuest: true,
  avatarKey: `${id}/${VERSION}`,
  avatarStatus: "APPROVED",
  ...extra,
});
const as = (id: string | null) =>
  id ? state.jar.set(GUEST_COOKIE, signGuestCookie(id, SECRET)) : state.jar.clear();

function get(userId: string, query = `size=256&v=${VERSION}`) {
  return GET(new Request(`http://localhost/api/avatars/${encodeURIComponent(userId)}?${query}`), {
    params: Promise.resolve({ userId }),
  });
}

describe("GET /api/avatars/[userId]", () => {
  beforeEach(async () => {
    state.jar.clear();
    state.rows = [row("alice"), row("bob"), row("pending", { avatarStatus: "PENDING" })];
    for (const id of ["alice", "bob", "pending"]) {
      await avatarStore.put(id, VERSION, {
        256: Buffer.from(`${id}-256`),
        64: Buffer.from(`${id}-64`),
      });
    }
  });
  afterAll(() => rmSync(state.dir, { recursive: true, force: true }));

  it.each([256, 64])(
    "C8: serves the owner's own avatar at size %i with private immutable caching",
    async (size) => {
      as("alice");
      const res = await get("alice", `size=${size}&v=${VERSION}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(`alice-${size}`);
    },
  );

  it("C8: another viewer gets 404 (no lobby access until #65)", async () => {
    as("bob");
    const res = await get("alice");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.arrayBuffer()).toHaveProperty("byteLength", 0);
  });

  it("C8: an anonymous request gets 404, as does a forged cookie", async () => {
    as(null);
    expect((await get("alice")).status).toBe(404);
    state.jar.set(GUEST_COOKIE, `alice.${"A".repeat(43)}`);
    expect((await get("alice")).status).toBe(404);
  });

  it.each([
    ["size=999", `size=999&v=${VERSION}`],
    ["size=128", `size=128&v=${VERSION}`],
    ["no size", `v=${VERSION}`],
    ["size=64.0", `size=64.0&v=${VERSION}`],
    ["no v", "size=64"],
    ["v not an integer", "size=64&v=abc"],
    ["v negative", "size=64&v=-1"],
    ["v leading zero", `size=64&v=0${VERSION}`],
    ["v beyond safe integers", "size=64&v=99999999999999999"],
  ])("C8: a bad query (%s) is 400, even for the owner", async (_l, query) => {
    as("alice");
    const res = await get("alice", query);
    expect(res.status).toBe(400);
  });

  it("C8: a bad size is 400 for anonymous requests too (no auth needed to reject it)", async () => {
    as(null);
    expect((await get("alice", `size=999&v=${VERSION}`)).status).toBe(400);
  });

  it("C8: a stale or unknown version is 404", async () => {
    as("alice");
    expect((await get("alice", `size=64&v=${VERSION + 1}`)).status).toBe(404);
  });

  it.each(["NONE", "PENDING", "REJECTED"] as const)(
    "C8 (#62), C5 (#64): an avatar whose status is %s is not served, even to its owner",
    async (status) => {
      state.rows[0]!.avatarStatus = status;
      as("alice");
      expect((await get("alice")).status).toBe(404);
    },
  );

  it("C8: a row without avatarKey or a missing file is 404", async () => {
    as("alice");
    state.rows[0]!.avatarKey = null;
    expect((await get("alice")).status).toBe(404);
    state.rows[0]!.avatarKey = `alice/${VERSION}`;
    rmSync(path.join(state.dir, "alice"), { recursive: true });
    expect((await get("alice")).status).toBe(404);
  });

  it.each(["../bob", "..%2Fbob", "alice/../bob", "a".repeat(65), "", "alice\u0000"])(
    "C8: a malformed user id (%j) is 404 without touching the store",
    async (userId) => {
      as("alice");
      expect((await get(userId)).status).toBe(404);
    },
  );
});
