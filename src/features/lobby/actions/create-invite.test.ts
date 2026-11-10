import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITE_TOKEN_RE } from "../invite-token";
import { fakeLobbyDb } from "../testing/fake-db";

// #808 C1: `createInvite({ code })`: zod first, the lobby must exist and be WAITING, the viewer
// (never an id from the input) must be its host, the `invite` rule (per `user:<id>`) is spent
// before any write, then one store `put` (SET NX EX 86400). No guest is created.
const state = vi.hoisted(() => ({
  db: null as unknown,
  viewer: null as { id: string } | null,
  limited: false,
  calls: [] as string[],
  puts: new Map<string, string>(),
  putResult: [] as ("ok" | "taken" | "unavailable")[],
}));

vi.mock("@/env", () => ({
  env: { NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "https://fifth.example" },
}));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/server/auth", () => ({
  getViewer: async () => {
    state.calls.push("getViewer");
    return state.viewer;
  },
}));
vi.mock("@/features/identity", () => ({
  ensureGuest: vi.fn(async () => {
    throw new Error("createInvite must not create a guest");
  }),
}));
vi.mock("@/server/limiter", () => ({
  limit: async (action: string, subject: string) => {
    state.calls.push(`limit:${action}:${subject}`);
    return { ok: !state.limited, retryAfterMs: state.limited ? 1_000 : 0 };
  },
}));
vi.mock("../invites/store", () => ({
  inviteStore: () => ({
    put: async (token: string, lobbyId: string) => {
      state.calls.push("put");
      const r = state.putResult.shift() ?? "ok";
      if (r === "ok") state.puts.set(token, lobbyId);
      return r;
    },
    has: async () => {
      throw new Error("unused");
    },
    take: async () => {
      throw new Error("unused");
    },
  }),
}));

const { createInvite } = await import("./create-invite");
const { ensureGuest } = await import("@/features/identity");

describe("createInvite (C1)", () => {
  let fake: ReturnType<typeof fakeLobbyDb>;

  beforeEach(() => {
    fake = fakeLobbyDb();
    state.db = fake.db;
    state.viewer = { id: "usr_host" };
    state.limited = false;
    state.calls = [];
    state.puts = new Map();
    state.putResult = [];
    fake.seedLobby({ id: "lob_open", code: "KGB-4821", status: "WAITING", hostUserId: "usr_host" });
    fake.seedLobby({
      id: "lob_closed",
      code: "ZRT-1093",
      status: "CLOSED",
      hostUserId: "usr_host",
    });
  });

  it("the host of a waiting lobby gets a single-use link to /invite/<token>", async () => {
    const r = await createInvite({ code: "kgb 4821" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = /^https:\/\/fifth\.example\/invite\/([^/]+)$/.exec(r.url);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(INVITE_TOKEN_RE);
    expect(state.puts.get(m![1]!)).toBe("lob_open");
    expect(state.calls).toEqual(["getViewer", "limit:invite:user:usr_host", "put"]);
    expect(ensureGuest).not.toHaveBeenCalled();
  });

  it("two links of one lobby carry different tokens", async () => {
    const a = await createInvite({ code: "KGB-4821" });
    const b = await createInvite({ code: "KGB-4821" });
    expect(a.ok && b.ok && a.url !== b.url).toBe(true);
    expect(state.puts.size).toBe(2);
  });

  it("malformed input is invalid and touches nothing", async () => {
    for (const input of [{}, { code: "" }, { code: 42 }, { code: "x".repeat(40) }, null]) {
      expect(await createInvite(input as never)).toEqual({ ok: false, error: "invalid" });
    }
    expect(state.calls).toEqual([]);
  });

  it("an unknown or unparsable room code is not-found; nothing is written", async () => {
    expect(await createInvite({ code: "QQQ-0000" })).toEqual({ ok: false, error: "not-found" });
    expect(await createInvite({ code: "nope" })).toEqual({ ok: false, error: "not-found" });
    expect(state.calls).not.toContain("put");
  });

  it("a viewer who is not the host, or no viewer, is not-host; no guest is created", async () => {
    state.viewer = { id: "usr_other" };
    expect(await createInvite({ code: "KGB-4821" })).toEqual({ ok: false, error: "not-host" });
    state.viewer = null;
    expect(await createInvite({ code: "KGB-4821" })).toEqual({ ok: false, error: "not-host" });
    expect(state.calls).not.toContain("put");
    expect(ensureGuest).not.toHaveBeenCalled();
  });

  it("an id in the input is ignored: the host is the row's hostUserId", async () => {
    state.viewer = { id: "usr_other" };
    const input = { code: "KGB-4821", hostUserId: "usr_host", userId: "usr_host" };
    expect(await createInvite(input as never)).toEqual({ ok: false, error: "not-host" });
  });

  it("a lobby that is not WAITING is closed; nothing is written", async () => {
    expect(await createInvite({ code: "ZRT-1093" })).toEqual({ ok: false, error: "closed" });
    expect(state.calls).not.toContain("put");
  });

  it("every answer costs budget: the rule is spent before the lookup, so a non-host cannot probe codes freely", async () => {
    state.viewer = { id: "usr_other" };
    await createInvite({ code: "QQQ-0000" });
    await createInvite({ code: "KGB-4821" });
    expect(state.calls).toEqual([
      "getViewer",
      "limit:invite:user:usr_other",
      "getViewer",
      "limit:invite:user:usr_other",
    ]);
    state.limited = true;
    expect(await createInvite({ code: "QQQ-0000" })).toEqual({ ok: false, error: "rate-limited" });
    expect(await createInvite({ code: "KGB-4821" })).toEqual({ ok: false, error: "rate-limited" });
    expect(fake.db.lobby.findUnique).toHaveBeenCalledTimes(2);
  });

  it("the invite rule is checked before any write: refused means rate-limited and nothing stored", async () => {
    state.limited = true;
    expect(await createInvite({ code: "KGB-4821" })).toEqual({ ok: false, error: "rate-limited" });
    expect(state.calls).toEqual(["getViewer", "limit:invite:user:usr_host"]);
    expect(state.puts.size).toBe(0);
  });

  it("C6: the store unavailable is unavailable, never a throw", async () => {
    state.putResult = ["unavailable"];
    expect(await createInvite({ code: "KGB-4821" })).toEqual({ ok: false, error: "unavailable" });
  });

  it("a token collision (NX refused) draws a fresh token once, then gives up as unavailable", async () => {
    state.putResult = ["taken", "ok"];
    expect((await createInvite({ code: "KGB-4821" })).ok).toBe(true);
    state.putResult = ["taken", "taken"];
    expect(await createInvite({ code: "KGB-4821" })).toEqual({ ok: false, error: "unavailable" });
  });

  it("C6: a lobby lookup that throws is unavailable, never a throw", async () => {
    fake.db.lobby.findUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await createInvite({ code: "KGB-4821" })).toEqual({ ok: false, error: "unavailable" });
  });
});
