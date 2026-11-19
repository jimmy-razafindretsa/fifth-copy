import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import { raceTokenClaimsSchema } from "@fifth-copy/protocol";
import { INVITE_TOKEN_RE } from "../invite-token";
import { fakeLobbyDb } from "../testing/fake-db";

// #999 C12, C13: the spectator link (host only, limiter first, `web:watch:<token>` reusable), the
// spectator mint through a link (limiter first, token looked up before any guest, fail closed, never
// a code), and the race page's code entry (`proveRoomCode`: only the page's own room, proof recorded).
const SECRET = "r".repeat(32);
const state = vi.hoisted(() => ({
  db: null as unknown,
  viewer: null as { id: string } | null,
  limited: new Set<string>(),
  calls: [] as string[],
  links: new Map<string, string>(),
  linkDown: false,
  proofs: new Set<string>(),
  proofDown: false,
  guests: 0,
}));

vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "https://fifth.example/",
    RACE_TOKEN_SECRET: "r".repeat(32),
    NEXT_PUBLIC_RACE_SERVER_URL: "http://race.test:4000",
  },
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
  ensureGuest: async () => {
    state.calls.push("ensureGuest");
    if (!state.viewer) {
      state.guests++;
      state.viewer = { id: `usr_guest${state.guests}` };
    }
    return { ...state.viewer, name: "Clerk 7" };
  },
  getAvatarUser: async () => ({ avatarVersion: null }),
}));
vi.mock("@/server/limiter", () => ({
  requestSubject: async () => "ip:203.0.113.9",
  limit: async (action: string, subject: string) => {
    state.calls.push(`limit:${action}:${subject}`);
    return { ok: !state.limited.has(action), retryAfterMs: 0 };
  },
  limitCode: async (action: string, subject: string) => {
    state.calls.push(`limitCode:${action}:${subject}`);
    return { ok: !state.limited.has(action), retryAfterMs: 0 };
  },
}));
vi.mock("../spectator-links/store", () => ({
  spectatorLinkStore: () => ({
    put: async (token: string, lobbyId: string) => {
      state.calls.push("put");
      if (state.linkDown) return "unavailable";
      state.links.set(token, lobbyId);
      return "ok";
    },
    get: async (token: string) => {
      state.calls.push("get");
      if (state.linkDown) return "unavailable";
      return state.links.get(token) ?? null;
    },
  }),
}));
vi.mock("@/server/room-code-proof", () => ({
  codeProofStore: () => ({
    record: async (user: string, lobby: string) => {
      state.calls.push("record");
      if (state.proofDown) return false;
      state.proofs.add(`${user}:${lobby}`);
      return true;
    },
    holds: async (user: string, lobby: string) => state.proofs.has(`${user}:${lobby}`),
  }),
}));

const { createSpectatorLink } = await import("./create-spectator-link");
const { mintSpectatorToken } = await import("./mint-spectator-token");
const { proveRoomCode } = await import("./prove-room-code");

const LINK = "A".repeat(43);

beforeEach(() => {
  const fake = fakeLobbyDb();
  state.db = fake.db;
  state.viewer = { id: "usr_host" };
  state.limited = new Set();
  state.calls = [];
  state.links = new Map([[LINK, "lob_open"]]);
  state.linkDown = false;
  state.proofs = new Set();
  state.proofDown = false;
  state.guests = 0;
  fake.seedLobby({ id: "lob_open", code: "KGB-4821", status: "WAITING", hostUserId: "usr_host" });
  fake.seedLobby({ id: "lob_closed", code: "ZRT-1093", status: "CLOSED", hostUserId: "usr_host" });
  fake.seedLobby({ id: "lob_other", code: "PRT-5555", status: "WAITING", hostUserId: "usr_x" });
});

describe("createSpectatorLink (C12)", () => {
  it("the host of a waiting lobby gets a reusable /watch/<token> link, limiter before the lookup", async () => {
    state.links = new Map();
    const r = await createSpectatorLink({ code: "kgb 4821" });
    if (!r.ok) throw new Error(r.error);
    const m = /^https:\/\/fifth\.example\/watch\/([^/]+)$/.exec(r.url);
    expect(m![1]).toMatch(INVITE_TOKEN_RE);
    expect(state.links.get(m![1]!)).toBe("lob_open");
    expect(state.calls).toEqual(["getViewer", "limit:spectator-link:user:usr_host", "put"]);
    expect(r.url).not.toContain("KGB");
  });

  it.each([
    ["no viewer", null, "KGB-4821", "not-host"],
    ["a player", { id: "usr_p" }, "KGB-4821", "not-host"],
    ["an unknown room", { id: "usr_host" }, "ABC-1234", "not-found"],
    ["a closed room", { id: "usr_host" }, "ZRT-1093", "closed"],
  ])("%s gets %s and no link", async (_, viewer, code, error) => {
    state.viewer = viewer;
    state.links = new Map();
    await expect(createSpectatorLink({ code })).resolves.toEqual({ ok: false, error });
    expect(state.links.size).toBe(0);
    expect(state.calls).not.toContain("ensureGuest");
  });

  it("a spent budget answers rate-limited before any lookup; Redis down is unavailable", async () => {
    state.limited.add("spectator-link");
    await expect(createSpectatorLink({ code: "KGB-4821" })).resolves.toEqual({
      ok: false,
      error: "rate-limited",
    });
    expect(state.calls).toEqual(["getViewer", "limit:spectator-link:user:usr_host"]);
    state.limited.clear();
    state.linkDown = true;
    await expect(createSpectatorLink({ code: "KGB-4821" })).resolves.toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("a malformed input is invalid before anything is read", async () => {
    await expect(createSpectatorLink({ code: 4 } as never)).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
    expect(state.calls).toEqual([]);
  });
});

describe("mintSpectatorToken (C12, C13)", () => {
  it("a link holder with no identity gets a spectator token and a guest created on demand", async () => {
    state.viewer = null;
    const r = await (
      mintSpectatorToken as (t: string, i: unknown) => ReturnType<typeof mintSpectatorToken>
    )(LINK, { code: null, spectator: true });
    if (!r.ok) throw new Error(r.error);
    const { payload } = await jwtVerify(r.token, new TextEncoder().encode(SECRET));
    const claims = raceTokenClaimsSchema.parse(payload);
    expect(claims).toMatchObject({ sub: "usr_guest1", lobby: "lob_open", role: "spectator" });
    expect(state.calls).toEqual(["limit:watch:ip:203.0.113.9", "get", "ensureGuest"]);
    // never the code, and no proof of it
    expect(JSON.stringify(r)).not.toContain("KGB");
    expect(JSON.stringify(payload)).not.toContain("KGB");
    expect(state.proofs.size).toBe(0);
  });

  it("is reusable: a second device reads the same link", async () => {
    state.viewer = null;
    expect((await mintSpectatorToken(LINK)).ok).toBe(true);
    state.viewer = null;
    expect((await mintSpectatorToken(LINK)).ok).toBe(true);
    expect(state.links.get(LINK)).toBe("lob_open");
  });

  it("a closed room's link still mints (a projector reloaded mid-race)", async () => {
    state.links.set(LINK, "lob_closed");
    expect((await mintSpectatorToken(LINK)).ok).toBe(true);
  });

  it.each([
    ["a malformed token", "short", "not-found"],
    ["an unknown token", "B".repeat(43), "not-found"],
  ])("%s is %s with no guest", async (_, token, error) => {
    state.viewer = null;
    await expect(mintSpectatorToken(token)).resolves.toEqual({ ok: false, error });
    expect(state.guests).toBe(0);
  });

  it("a link whose room is gone is not-found", async () => {
    state.links.set(LINK, "lob_gone");
    state.viewer = null;
    await expect(mintSpectatorToken(LINK)).resolves.toEqual({ ok: false, error: "not-found" });
    expect(state.guests).toBe(0);
  });

  it("fails closed: Redis down is unavailable; a spent budget reads nothing", async () => {
    state.viewer = null;
    state.linkDown = true;
    await expect(mintSpectatorToken(LINK)).resolves.toEqual({ ok: false, error: "unavailable" });
    expect(state.guests).toBe(0);
    state.calls = [];
    state.limited.add("watch");
    await expect(mintSpectatorToken(LINK)).resolves.toEqual({ ok: false, error: "rate-limited" });
    expect(state.calls).toEqual(["limit:watch:ip:203.0.113.9"]);
  });
});

describe("proveRoomCode (C13)", () => {
  it("the page's own code records the viewer's proof (a guest created after the match)", async () => {
    state.viewer = null;
    await expect(proveRoomCode({ lobbyId: "lob_open", code: "kgb4821" })).resolves.toEqual({
      ok: true,
    });
    expect([...state.proofs]).toEqual(["usr_guest1:lob_open"]);
    expect(state.calls[0]).toBe("limitCode:join-by-code:ip:203.0.113.9");
  });

  it.each([
    ["another room's code", "lob_open", "PRT-5555", "not-found"],
    ["an unknown code", "lob_open", "ABC-1234", "not-found"],
    ["a malformed code", "lob_open", "K", "invalid-format"],
    ["a closed room", "lob_closed", "ZRT-1093", "closed"],
  ])("%s is %s, no guest, no proof", async (_, lobbyId, code, error) => {
    state.viewer = null;
    await expect(proveRoomCode({ lobbyId, code })).resolves.toEqual({ ok: false, error });
    expect(state.guests).toBe(0);
    expect(state.proofs.size).toBe(0);
  });

  it("a spent budget is rate-limited before the lookup; an unwritable proof is unavailable", async () => {
    state.limited.add("join-by-code");
    await expect(proveRoomCode({ lobbyId: "lob_open", code: "KGB-4821" })).resolves.toEqual({
      ok: false,
      error: "rate-limited",
    });
    state.limited.clear();
    state.proofDown = true;
    await expect(proveRoomCode({ lobbyId: "lob_open", code: "KGB-4821" })).resolves.toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});
