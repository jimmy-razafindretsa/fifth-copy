import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import { raceTokenClaimsSchema } from "@fifth-copy/protocol";
import { fakeLobbyDb } from "../testing/fake-db";

const RACE_TOKEN_SECRET = "r".repeat(32);
const RACE_URL = "http://race.test:4000";

const state = vi.hoisted(() => ({
  jar: new Map<string, { value: string }>(),
  db: null as unknown,
  // #999 C13: the code proofs on file, `<user>:<lobby>`
  proofs: new Set<string>(),
}));
vi.mock("@/server/room-code-proof", () => ({
  codeProofStore: () => ({
    record: async (user: string, lobby: string) => (state.proofs.add(`${user}:${lobby}`), true),
    holds: async (user: string, lobby: string) => state.proofs.has(`${user}:${lobby}`),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = state.jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string) => void state.jar.set(name, { value }),
    delete: (name: string) => void state.jar.delete(name),
  }),
  // No forwarding headers: the limiter's subject is the guest or `ip:unknown` (#207).
  headers: async () => new Headers(),
}));
vi.mock("@/env", () => ({
  env: {
    NODE_ENV: "test",
    AUTH_SECRET: "a".repeat(32),
    RACE_TOKEN_SECRET: "r".repeat(32),
    NEXT_PUBLIC_RACE_SERVER_URL: "http://race.test:4000",
  },
}));
vi.mock("@/server/db", () => ({
  db: new Proxy({}, { get: (_t, key) => (state.db as Record<PropertyKey, unknown>)[key] }),
}));

const { mintRaceToken } = await import("../index");
const { ensureGuest } = await import("@/features/identity");

async function verified(token: string) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(RACE_TOKEN_SECRET));
  return { payload, claims: raceTokenClaimsSchema.parse(payload) };
}

describe("mintRaceToken (unit, fake DB)", () => {
  let fake: ReturnType<typeof fakeLobbyDb>;
  let hostId: string;

  beforeEach(async () => {
    fake = fakeLobbyDb();
    state.db = fake.db;
    state.jar = new Map();
    state.proofs = new Set();
    hostId = (await ensureGuest()).id;
    fake.seedLobby({ id: "lob_open", code: "KGB-4821", status: "WAITING", hostUserId: hostId });
    fake.seedLobby({ id: "lob_closed", code: "ZRT-1093", status: "CLOSED", hostUserId: hostId });
    fake.db.user.create.mockClear();
  });

  it("C6: the creator gets a verifiable 300 s host token for the lobby and the socket URL", async () => {
    const result = await mintRaceToken({ code: "kgb 4821" });
    if (!result.ok) throw new Error(result.error);
    expect(result.url).toBe(RACE_URL);
    const { payload, claims } = await verified(result.token);
    expect(claims).toMatchObject({ sub: hostId, lobby: "lob_open", role: "host" });
    expect(claims.name).toBe(fake.users[0]!.typistName);
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(fake.db.user.create).not.toHaveBeenCalled();
  });

  it("#730: the token carries the version of the viewer's approved avatar, null otherwise", async () => {
    const none = await mintRaceToken({ code: "KGB-4821" });
    if (!none.ok) throw new Error(none.error);
    expect((await verified(none.token)).claims.avatar).toBeNull();

    Object.assign(fake.users[0]!, { avatarStatus: "PENDING", avatarKey: `${hostId}/3` });
    const pending = await mintRaceToken({ code: "KGB-4821" });
    if (!pending.ok) throw new Error(pending.error);
    expect((await verified(pending.token)).claims.avatar).toBeNull();

    Object.assign(fake.users[0]!, { avatarStatus: "APPROVED", avatarKey: `${hostId}/4` });
    const approved = await mintRaceToken({ code: "KGB-4821" });
    if (!approved.ok) throw new Error(approved.error);
    expect((await verified(approved.token)).claims.avatar).toBe(4);
  });

  it("C6: another browser becomes a guest player; its second call reuses the same sub", async () => {
    state.jar = new Map();
    const first = await mintRaceToken({ code: "KGB-4821" });
    const second = await mintRaceToken({ code: "KGB-4821" });
    if (!first.ok || !second.ok) throw new Error("mint failed");
    const a = (await verified(first.token)).claims;
    const b = (await verified(second.token)).claims;
    expect(a).toMatchObject({ role: "player", lobby: "lob_open" });
    expect(a.sub).not.toBe(hostId);
    expect(b.sub).toBe(a.sub);
    expect(fake.db.user.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ABC-1234", "not-found"],
    ["KG-1", "not-found"],
    ["", "not-found"],
    ["ZRT-1093", "closed"],
  ])("C6: %j returns %s without minting or creating a guest", async (code, error) => {
    state.jar = new Map();
    await expect(mintRaceToken({ code })).resolves.toEqual({ ok: false, error });
    expect(fake.db.user.create).not.toHaveBeenCalled();
    expect(state.jar.size).toBe(0);
  });

  it("#187 C1: spectator: true mints a spectator token for a player and for the host", async () => {
    const host = await mintRaceToken({ code: "KGB-4821", spectator: true });
    if (!host.ok) throw new Error(host.error);
    expect((await verified(host.token)).claims).toMatchObject({
      sub: hostId,
      lobby: "lob_open",
      role: "spectator",
    });
    state.jar = new Map();
    const player = await mintRaceToken({ code: "KGB-4821", spectator: true });
    if (!player.ok) throw new Error(player.error);
    const claims = (await verified(player.token)).claims;
    expect(claims).toMatchObject({ lobby: "lob_open", role: "spectator" });
    expect(claims.sub).not.toBe(hostId);
  });

  it("#187 C1: spectator: false keeps the host and player roles", async () => {
    const host = await mintRaceToken({ code: "KGB-4821", spectator: false });
    if (!host.ok) throw new Error(host.error);
    expect((await verified(host.token)).claims.role).toBe("host");
    state.jar = new Map();
    const player = await mintRaceToken({ code: "KGB-4821", spectator: false });
    if (!player.ok) throw new Error(player.error);
    expect((await verified(player.token)).claims.role).toBe("player");
  });

  it("#187 C1, #999: a CLOSED lobby returns closed for a spectator who never proved its code", async () => {
    state.jar = new Map();
    await expect(mintRaceToken({ code: "ZRT-1093", spectator: true })).resolves.toEqual({
      ok: false,
      error: "closed",
    });
    expect(fake.db.user.create).not.toHaveBeenCalled();
  });

  it("#187 C1: a non-boolean spectator flag is not-found, never a role", async () => {
    state.jar = new Map();
    await expect(
      mintRaceToken({ code: "KGB-4821", spectator: "yes" } as unknown as { code: string }),
    ).resolves.toEqual({ ok: false, error: "not-found" });
    expect(fake.db.user.create).not.toHaveBeenCalled();
  });

  it("#999 C13: a mint records the minted viewer's code proof for that lobby", async () => {
    state.jar = new Map();
    const result = await mintRaceToken({ code: "KGB-4821", spectator: true });
    if (!result.ok) throw new Error(result.error);
    const { sub } = (await verified(result.token)).claims;
    expect([...state.proofs]).toEqual([`${sub}:lob_open`]);
  });

  it("#999 C13: a code of another room than the page's lobbyId is not-found, no guest, no proof", async () => {
    state.jar = new Map();
    await expect(
      mintRaceToken({ code: "KGB-4821", spectator: true, lobbyId: "lob_other" }),
    ).resolves.toEqual({ ok: false, error: "not-found" });
    expect(fake.db.user.create).not.toHaveBeenCalled();
    expect(state.proofs.size).toBe(0);
    const ok = await mintRaceToken({ code: "KGB-4821", spectator: true, lobbyId: "lob_open" });
    expect(ok.ok).toBe(true);
  });

  it("#999 M3a: a CLOSED lobby still mints a spectator token for its host and for a proof holder", async () => {
    const host = await mintRaceToken({ code: "ZRT-1093", spectator: true });
    if (!host.ok) throw new Error(host.error);
    expect((await verified(host.token)).claims).toMatchObject({
      sub: hostId,
      lobby: "lob_closed",
      role: "spectator",
    });
    // the host's own seat on a closed room stays closed
    await expect(mintRaceToken({ code: "ZRT-1093" })).resolves.toEqual({
      ok: false,
      error: "closed",
    });

    state.jar = new Map();
    const watcher = await ensureGuest();
    await expect(mintRaceToken({ code: "ZRT-1093", spectator: true })).resolves.toEqual({
      ok: false,
      error: "closed",
    });
    state.proofs.add(`${watcher.id}:lob_closed`);
    const back = await mintRaceToken({ code: "ZRT-1093", spectator: true });
    if (!back.ok) throw new Error(back.error);
    expect((await verified(back.token)).claims).toMatchObject({
      sub: watcher.id,
      role: "spectator",
    });
    await expect(mintRaceToken({ code: "ZRT-1093" })).resolves.toEqual({
      ok: false,
      error: "closed",
    });
  });

  it("a token signed with another secret is rejected by jwtVerify", async () => {
    const result = await mintRaceToken({ code: "KGB-4821" });
    if (!result.ok) throw new Error(result.error);
    await expect(
      jwtVerify(result.token, new TextEncoder().encode("x".repeat(32))),
    ).rejects.toThrow();
  });
});
