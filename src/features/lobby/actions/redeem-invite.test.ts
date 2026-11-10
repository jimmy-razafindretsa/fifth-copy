import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLobbyDb } from "../testing/fake-db";

// #808 C3-C6: `redeemInvite({ token })` and `peekInvite(token)`. A malformed token is invalid
// without touching Redis; the `invite-redeem` rule (per requestSubject) comes first; then one
// `take` (GETDEL) or `has` (EXISTS). Neither creates a guest (ADR 0009). Redis down: unavailable.
const state = vi.hoisted(() => ({
  db: null as unknown,
  limited: false,
  calls: [] as string[],
  tokens: new Map<string, string>(),
  down: false,
}));

vi.mock("@/env", () => ({ env: { NODE_ENV: "test" } }));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));
vi.mock("@/features/identity", () => ({ ensureGuest: vi.fn() }));
vi.mock("@/server/auth", () => ({ getViewer: vi.fn(), requireViewer: vi.fn() }));
vi.mock("@/server/limiter", () => ({
  requestSubject: async () => "ip:203.0.113.7",
  limit: async (action: string, subject: string) => {
    state.calls.push(`limit:${action}:${subject}`);
    return { ok: !state.limited, retryAfterMs: state.limited ? 1_000 : 0 };
  },
}));
/** A fake store with GETDEL semantics: the read and the delete happen in one step. */
vi.mock("../invites/store", () => ({
  inviteStore: () => ({
    put: async () => {
      throw new Error("unused");
    },
    has: async (token: string) => {
      state.calls.push("has");
      if (state.down) return "unavailable";
      return state.tokens.has(token);
    },
    take: async (token: string) => {
      state.calls.push("take");
      if (state.down) return "unavailable";
      await Promise.resolve();
      const lobbyId = state.tokens.get(token) ?? null;
      state.tokens.delete(token);
      return lobbyId;
    },
  }),
}));

const { redeemInvite, peekInvite } = await import("./redeem-invite");
const identity = await import("@/features/identity");
const auth = await import("@/server/auth");

const T = (c: string) => c.repeat(43);

describe("redeemInvite / peekInvite", () => {
  let fake: ReturnType<typeof fakeLobbyDb>;

  beforeEach(() => {
    fake = fakeLobbyDb();
    state.db = fake.db;
    state.limited = false;
    state.calls = [];
    state.down = false;
    state.tokens = new Map([
      [T("a"), "lob_open"],
      [T("b"), "lob_closed"],
      [T("c"), "lob_gone"],
    ]);
    fake.seedLobby({ id: "lob_open", code: "KGB-4821", status: "WAITING", hostUserId: "usr_h" });
    fake.seedLobby({ id: "lob_closed", code: "ZRT-1093", status: "CLOSED", hostUserId: "usr_h" });
  });

  it("C3: a token on file for a WAITING lobby returns its code, once", async () => {
    expect(await redeemInvite({ token: T("a") })).toEqual({ ok: true, code: "KGB-4821" });
    expect(state.calls).toEqual(["limit:invite-redeem:ip:203.0.113.7", "take"]);
    expect(await redeemInvite({ token: T("a") })).toEqual({ ok: false, error: "not-found" });
  });

  it("C3: a malformed token is invalid without touching Redis (no limiter, no store)", async () => {
    for (const input of [
      { token: "short" },
      { token: `${T("a").slice(1)}=` },
      { token: T("a") + "a" },
      { token: 42 },
      {},
      null,
    ]) {
      expect(await redeemInvite(input as never)).toEqual({ ok: false, error: "invalid" });
    }
    expect(state.calls).toEqual([]);
  });

  it("C3: a token never issued is not-found", async () => {
    expect(await redeemInvite({ token: T("z") })).toEqual({ ok: false, error: "not-found" });
  });

  it("C3: a CLOSED or missing lobby is closed (and the token is spent)", async () => {
    expect(await redeemInvite({ token: T("b") })).toEqual({ ok: false, error: "closed" });
    expect(await redeemInvite({ token: T("c") })).toEqual({ ok: false, error: "closed" });
    expect(state.tokens.size).toBe(1);
  });

  it("C3: the invite-redeem rule is checked first: refused means rate-limited, nothing consumed", async () => {
    state.limited = true;
    expect(await redeemInvite({ token: T("a") })).toEqual({ ok: false, error: "rate-limited" });
    expect(state.calls).toEqual(["limit:invite-redeem:ip:203.0.113.7"]);
    expect(state.tokens.has(T("a"))).toBe(true);
  });

  it("C3: two concurrent redeems of one token get exactly one ok", async () => {
    const outcomes = await Promise.all([
      redeemInvite({ token: T("a") }),
      redeemInvite({ token: T("a") }),
    ]);
    expect(outcomes.filter((o) => o.ok)).toEqual([{ ok: true, code: "KGB-4821" }]);
    expect(outcomes.filter((o) => !o.ok)).toEqual([{ ok: false, error: "not-found" }]);
    expect(state.calls.filter((c) => c === "take")).toHaveLength(2);
  });

  it("C4: peek answers on file or not, consumes nothing, spends the same rule", async () => {
    expect(await peekInvite(T("a"))).toEqual({ ok: true });
    expect(await peekInvite(T("a"))).toEqual({ ok: true });
    expect(await peekInvite(T("z"))).toEqual({ ok: false, error: "not-found" });
    expect(state.tokens.get(T("a"))).toBe("lob_open");
    expect(state.calls).not.toContain("take");
    expect(state.calls.filter((c) => c.startsWith("limit:"))).toEqual(
      Array(3).fill("limit:invite-redeem:ip:203.0.113.7"),
    );
    expect(await redeemInvite({ token: T("a") })).toEqual({ ok: true, code: "KGB-4821" });
  });

  it("C4: peek of a malformed token is invalid without touching Redis; limited is rate-limited", async () => {
    expect(await peekInvite("nope")).toEqual({ ok: false, error: "invalid" });
    expect(await peekInvite(42 as never)).toEqual({ ok: false, error: "invalid" });
    expect(state.calls).toEqual([]);
    state.limited = true;
    expect(await peekInvite(T("a"))).toEqual({ ok: false, error: "rate-limited" });
    expect(state.calls).not.toContain("has");
  });

  it("C5: neither redeem nor peek creates a guest or reads the viewer", async () => {
    await redeemInvite({ token: T("a") });
    await redeemInvite({ token: T("z") });
    await peekInvite(T("b"));
    expect(identity.ensureGuest).not.toHaveBeenCalled();
    expect(auth.getViewer).not.toHaveBeenCalled();
    expect(fake.db.user.create).not.toHaveBeenCalled();
  });

  it("C6: Redis down: redeem and peek are unavailable (fail closed), never a throw", async () => {
    state.down = true;
    expect(await redeemInvite({ token: T("a") })).toEqual({ ok: false, error: "unavailable" });
    expect(await peekInvite(T("a"))).toEqual({ ok: false, error: "unavailable" });
  });

  it("C6: a lobby lookup that throws after the take is unavailable, never a throw", async () => {
    fake.db.lobby.findUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await redeemInvite({ token: T("a") })).toEqual({ ok: false, error: "unavailable" });
  });
});
