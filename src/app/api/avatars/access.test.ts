import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/server/limiter/core";
import { GUEST_COOKIE, signGuestCookie } from "@/server/auth/guest-cookie";

// #880 C3-C6: GET /api/avatars/[userId] for lobby mates. Real route, real viewer resolution (signed
// guest cookie), real `readAvatarFile`, real `shareLobby` and real filesystem store; faked: cookies,
// env, the db (User rows, RaceResult reads), the race server client (`sharedRoom`) and the limiter.
const SECRET = "v".repeat(32);
const VERSION = 1_700_000_000_000;
type Status = "NONE" | "PENDING" | "APPROVED" | "REJECTED";
type Row = { id: string; avatarKey: string | null; avatarStatus: Status };

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  rows: [] as Row[],
  dir: "",
  /** Pairs the race server says share a live room ("a|b", both orders). */
  live: new Set<string>(),
  /** Pairs that raced together in the last 24 h. */
  recent: new Set<string>(),
  raceServerDown: false,
  /** Calls left before the limiter refuses (per subject). */
  budget: new Map<string, number>(),
}));
state.dir = mkdtempSync(path.join(tmpdir(), "fc-avatar-access-"));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined),
  }),
}));
vi.mock("@/env", () => ({
  env: {
    AUTH_SECRET: "v".repeat(32),
    NODE_ENV: "test",
    RACE_SERVER_INTERNAL_URL: "http://race.invalid",
    RACE_TOKEN_SECRET: "s".repeat(32),
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
    raceResult: {
      findFirst: vi.fn(
        async ({ where }: { where: { userId: string; race: { results: { some: { userId: string } } } } }) =>
          state.recent.has(`${where.userId}|${where.race.results.some.userId}`) ? { id: "r" } : null,
      ),
    },
  },
}));
const sharedRoom = vi.hoisted(() => vi.fn());
vi.mock("@/server/internal-api/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createInternalApiClient: () => ({ sharedRoom }),
}));
const limit = vi.hoisted(() => vi.fn());
vi.mock("@/server/limiter", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  limit,
}));

const { GET } = await import("./[userId]/route");
const { avatarStore } = await import("@/features/identity");
const { db } = await import("@/server/db");

const row = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  avatarKey: `${id}/${VERSION}`,
  avatarStatus: "APPROVED",
  ...extra,
});
const as = (id: string | null) =>
  id ? state.jar.set(GUEST_COOKIE, signGuestCookie(id, SECRET)) : state.jar.clear();
const pair = (set: Set<string>, a: string, b: string) => set.add(`${a}|${b}`).add(`${b}|${a}`);

function get(userId: string, query = `size=256&v=${VERSION}`) {
  return GET(new Request(`http://localhost/api/avatars/${encodeURIComponent(userId)}?${query}`), {
    params: Promise.resolve({ userId }),
  });
}

/** Status, every header and the body: what "identical" means for C3. */
async function shape(res: Response) {
  return {
    status: res.status,
    headers: [...res.headers.entries()].sort(),
    body: Buffer.from(await res.arrayBuffer()).toString("hex"),
  };
}

let storeGet: ReturnType<typeof vi.spyOn>;

describe("GET /api/avatars/[userId] for lobby mates (#880)", () => {
  beforeEach(async () => {
    state.jar.clear();
    state.live.clear();
    state.recent.clear();
    state.raceServerDown = false;
    state.budget.clear();
    state.rows = [
      row("alice"),
      row("bob"),
      row("carol"),
      row("nopic", { avatarKey: null, avatarStatus: "NONE" }),
      row("pending", { avatarStatus: "PENDING" }),
      row("rejected", { avatarStatus: "REJECTED" }),
    ];
    for (const id of ["alice", "bob", "carol", "pending", "rejected"]) {
      await avatarStore.put(id, VERSION, {
        256: Buffer.from(`${id}-256`),
        64: Buffer.from(`${id}-64`),
      });
    }
    sharedRoom.mockReset();
    sharedRoom.mockImplementation(async ({ userIds: [a, b] }: { userIds: [string, string] }) =>
      state.raceServerDown
        ? { ok: false, error: "race-server-unavailable" }
        : { ok: true, data: { v: 1, shared: state.live.has(`${a}|${b}`) } },
    );
    limit.mockReset();
    limit.mockImplementation(async (_action: string, subject: string) => {
      const left = state.budget.get(subject) ?? Infinity;
      state.budget.set(subject, left - 1);
      return { ok: left > 0, retryAfterMs: left > 0 ? 0 : 1_000 };
    });
    vi.mocked(db.user.findUnique).mockClear();
    vi.mocked(db.raceResult.findFirst).mockClear();
    storeGet?.mockRestore();
    storeGet = vi.spyOn(avatarStore, "get");
  });
  afterAll(() => rmSync(state.dir, { recursive: true, force: true }));

  describe("C3 who gets the image", () => {
    it("a live-room mate gets the WebP with the ADR 0014 headers", async () => {
      pair(state.live, "bob", "alice");
      as("bob");
      const res = await get("alice");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("alice-256");
      expect(sharedRoom).toHaveBeenCalledTimes(1);
      expect(sharedRoom.mock.calls[0]![0].userIds).toEqual(["bob", "alice"]);
    });

    it("a race mate of the last 24 h gets it with the race server down", async () => {
      pair(state.recent, "bob", "alice");
      state.raceServerDown = true;
      as("bob");
      const res = await get("alice", `size=64&v=${VERSION}`);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("alice-64");
    });

    it("the owner gets their own avatar with no race server call and no limiter spend", async () => {
      as("alice");
      const res = await get("alice");
      expect(res.status).toBe(200);
      expect(sharedRoom).not.toHaveBeenCalled();
      expect(db.raceResult.findFirst).not.toHaveBeenCalled();
      expect(limit).not.toHaveBeenCalled();
    });

    it("a mate whose live room the race server cannot confirm is refused (fail closed)", async () => {
      pair(state.live, "bob", "alice");
      state.raceServerDown = true;
      as("bob");
      expect((await get("alice")).status).toBe(404);
    });

    it("every refusal is the same 404: no lobby, unknown owner, no avatar, PENDING, REJECTED, stale v", async () => {
      as("bob");
      const reference = await shape(await get("alice"));
      expect(reference).toEqual({
        status: 404,
        headers: [
          ["cache-control", "private, no-store"],
          ["vary", "Cookie"],
        ],
        body: "",
      });
      // A viewer who shares no lobby, an owner id that does not exist, and the owner-side refusals
      // below once the viewer shares a lobby with them: all byte-identical to the reference.
      expect(await shape(await get("ghost"))).toEqual(reference);
      for (const owner of ["nopic", "pending", "rejected", "ghost", "alice"]) {
        pair(state.live, "bob", owner);
      }
      for (const owner of ["nopic", "pending", "rejected", "ghost"]) {
        expect(await shape(await get(owner)), owner).toEqual(reference);
      }
      expect(await shape(await get("alice", `size=256&v=${VERSION + 1}`)), "stale v").toEqual(
        reference,
      );
    });

    it("the owner's own refusals (no avatar, stale v) are the same 404 too", async () => {
      as("bob");
      const reference = await shape(await get("alice"));
      as("nopic");
      expect(await shape(await get("nopic"))).toEqual(reference);
      as("alice");
      expect(await shape(await get("alice", `size=256&v=${VERSION + 1}`))).toEqual(reference);
    });
  });

  describe("C4 no oracle for a non-member", () => {
    it.each(["alice", "ghost", "nopic", "pending"])(
      "a refused viewer asking for %s reads no User row and no file",
      async (owner) => {
        as("bob");
        expect((await get(owner)).status).toBe(404);
        expect(sharedRoom).toHaveBeenCalledTimes(1);
        expect(db.user.findUnique).not.toHaveBeenCalled();
        expect(storeGet).not.toHaveBeenCalled();
      },
    );

    it("the User row and the store are read only after shareLobby answered true", async () => {
      const order: string[] = [];
      sharedRoom.mockImplementationOnce(async () => {
        order.push("sharedRoom");
        return { ok: true, data: { v: 1, shared: true } };
      });
      vi.mocked(db.user.findUnique).mockImplementationOnce((async () => {
        order.push("user");
        return row("alice");
      }) as never);
      storeGet.mockImplementationOnce(async () => {
        order.push("store");
        return Buffer.from("x");
      });
      as("bob");
      expect((await get("alice")).status).toBe(200);
      expect(order).toEqual(["sharedRoom", "user", "store"]);
    });
  });

  describe("C5 anonymous requests and cache headers", () => {
    it("an anonymous request is 404 with no race server call and no database read", async () => {
      as(null);
      const res = await get("alice");
      expect(res.status).toBe(404);
      expect(sharedRoom).not.toHaveBeenCalled();
      expect(limit).not.toHaveBeenCalled();
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(db.raceResult.findFirst).not.toHaveBeenCalled();
      expect(storeGet).not.toHaveBeenCalled();
    });

    it("an anonymous request with a forged cookie is the same", async () => {
      state.jar.set(GUEST_COOKIE, `alice.${"A".repeat(43)}`);
      expect((await get("alice")).status).toBe(404);
      expect(sharedRoom).not.toHaveBeenCalled();
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ["200 owner", "alice", "alice", `size=64&v=${VERSION}`, 200],
      ["200 mate", "bob", "alice", `size=64&v=${VERSION}`, 200],
      ["400 bad size", "bob", "alice", `size=999&v=${VERSION}`, 400],
      ["400 anonymous", null, "alice", "size=64", 400],
      ["404 stranger", "carol", "alice", `size=64&v=${VERSION}`, 404],
      ["404 anonymous", null, "alice", `size=64&v=${VERSION}`, 404],
    ] as const)("%s carries Vary: Cookie and a private Cache-Control", async (_l, viewer, owner, q, status) => {
      pair(state.live, "bob", "alice");
      as(viewer);
      const res = await get(owner, q);
      expect(res.status).toBe(status);
      expect(res.headers.get("vary")).toBe("Cookie");
      expect(res.headers.get("cache-control")).toMatch(/^private(,|$)/);
    });
  });

  describe("C6 per-viewer limit", () => {
    it("is LIMITS['avatar-view']: 240 per minute", () => {
      expect(LIMITS["avatar-view"]).toEqual({ max: 240, windowMs: 60_000 });
    });

    it("a non-owner lookup spends avatar-view on user:<viewerId> before shareLobby", async () => {
      const order: string[] = [];
      limit.mockImplementationOnce(async () => {
        order.push("limit");
        return { ok: true, retryAfterMs: 0 };
      });
      sharedRoom.mockImplementationOnce(async () => {
        order.push("sharedRoom");
        return { ok: true, data: { v: 1, shared: false } };
      });
      as("bob");
      await get("alice");
      expect(limit).toHaveBeenCalledWith("avatar-view", "user:bob");
      expect(order).toEqual(["limit", "sharedRoom"]);
    });

    it("over the limit a lobby mate gets the same 404 and no race server call is made", async () => {
      pair(state.live, "bob", "alice");
      pair(state.recent, "bob", "alice");
      as("bob");
      const reference = await shape(await get("ghost"));
      state.budget.set("user:bob", 0);
      expect(await shape(await get("alice"))).toEqual(reference);
      expect(sharedRoom).toHaveBeenCalledTimes(1); // the reference call only
      expect(db.raceResult.findFirst).toHaveBeenCalledTimes(1);
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it("the owner's own requests are not counted, even over the limit", async () => {
      state.budget.set("user:alice", 0);
      as("alice");
      expect((await get("alice")).status).toBe(200);
      expect(limit).not.toHaveBeenCalled();
    });
  });
});
