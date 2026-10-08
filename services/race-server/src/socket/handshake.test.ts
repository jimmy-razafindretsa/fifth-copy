import { base64url, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, RACE_TOKEN_TTL_S } from "@fifth-copy/protocol";
import { boot, connectError, SECRET, type Booted } from "../testing/harness";
import type { ResumeEntry } from "../players/resume-keys";
import { authenticateHandshake } from "./handshake";

let t: Booted | undefined;
afterEach(async () => {
  await t?.stop();
  t = undefined;
});

function tamper(token: string, lobby: string) {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(new TextDecoder().decode(base64url.decode(payload!)));
  const forged = base64url.encode(JSON.stringify({ ...claims, lobby, role: "host" }));
  return `${header}.${forged}.${signature}`;
}

describe("authenticateHandshake (C2)", () => {
  it("accepts a valid token for an open room and returns its claims, without joining", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const token = await t.token({ lobby, sub: "usr_a", name: "Ada" });
    const deps = { secret: SECRET, registry: t.server.registry, clock: t.clock };
    expect(await authenticateHandshake({ v: PROTOCOL_VERSION, token }, deps)).toEqual({
      ok: true,
      claims: { v: PROTOCOL_VERSION, sub: "usr_a", name: "Ada", lobby, role: "player" },
      resume: false,
    });
    expect(await t.server.registry.members(lobby)).toEqual([]);
  });

  it("refuses a new user of a started room with in-progress; a member still passes (#166)", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const { registry } = t.server;
    await registry.join(lobby, { userId: "usr_a", name: "Ada" });
    await registry.startRace(lobby, {
      race: {
        raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
        text: "Le dossier.",
        language: "fr",
        wordCount: 2,
        t0: t.clock.now(),
        timerS: null,
      },
      endAt: t.clock.now() + 60_000,
      desks: [{ desk: 1, userId: "usr_a", name: "Ada", isBot: false }],
    });
    await registry.setPhase(lobby, "running");
    const deps = { secret: SECRET, registry, clock: t.clock };
    const as = async (sub: string) =>
      authenticateHandshake({ v: PROTOCOL_VERSION, token: await t!.token({ lobby, sub }) }, deps);
    expect(await as("usr_new")).toEqual({ ok: false, reason: "in-progress" });
    expect(await as("usr_a")).toMatchObject({ ok: true });
  });

  it("accepts a well-formed resumeKey (restoring a desk is #178's)", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const token = await t.token({ lobby });
    const deps = { secret: SECRET, registry: t.server.registry, clock: t.clock };
    const auth = { v: PROTOCOL_VERSION, token, resumeKey: "ab".repeat(32) };
    expect(await authenticateHandshake(auth, deps)).toMatchObject({ ok: true });
  });

  it.each([
    ["no auth", () => undefined, "version"],
    [
      "a junk resumeKey",
      (tok: string) => ({ v: PROTOCOL_VERSION, token: tok, resumeKey: "x" }),
      "bad-token",
    ],
    [
      "an oversize resumeKey",
      (tok: string) => ({ v: PROTOCOL_VERSION, token: tok, resumeKey: "a".repeat(65) }),
      "bad-token",
    ],
    ["auth.v: 1", (tok: string) => ({ v: 1, token: tok }), "version"],
    ["a missing token", () => ({ v: PROTOCOL_VERSION }), "bad-token"],
    ["an empty token", () => ({ v: PROTOCOL_VERSION, token: "" }), "bad-token"],
    ["a non-string token", () => ({ v: PROTOCOL_VERSION, token: 42 }), "bad-token"],
  ] as const)("refuses %s as %s", async (_, auth, reason) => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const deps = { secret: SECRET, registry: t.server.registry, clock: t.clock };
    expect(await authenticateHandshake(auth(await t.token({ lobby })), deps)).toEqual({
      ok: false,
      reason,
    });
  });
});

describe("spectator tokens (#187)", () => {
  it("accepts a spectator token for a waiting room, without membership and without joining", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const token = await t.token({ lobby, sub: "usr_s", name: "Eve", role: "spectator" });
    const deps = { secret: SECRET, registry: t.server.registry, clock: t.clock };
    expect(await authenticateHandshake({ v: PROTOCOL_VERSION, token }, deps)).toEqual({
      ok: true,
      claims: { v: PROTOCOL_VERSION, sub: "usr_s", name: "Eve", lobby, role: "spectator" },
      resume: false,
    });
    expect(await t.server.registry.members(lobby)).toEqual([]);
  });

  it("accepts a non-member spectator of a running room; never resumes, never looks a key up", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await runningRoom(t);
    const lookup = vi.fn(async () => ({ lobbyId: lobby, userId: "usr_a", desk: 1 }));
    const deps = {
      secret: SECRET,
      registry: t.server.registry,
      clock: t.clock,
      resumeKeys: { lookup },
    };
    // A stranger and a member's own sub (a host's projector tab) with that member's valid key.
    for (const sub of ["usr_new", "usr_a"]) {
      const token = await t.token({ lobby, sub, role: "spectator" });
      expect(
        await authenticateHandshake(
          { v: PROTOCOL_VERSION, token, resumeKey: "a1".repeat(32) },
          deps,
        ),
      ).toMatchObject({ ok: true, resume: false, claims: { role: "spectator", sub } });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a spectator token for a missing room with no-room", async () => {
    t = await boot(process.env.REDIS_URL);
    const token = await t.token({ lobby: t.lobby(), role: "spectator" });
    const deps = { secret: SECRET, registry: t.server.registry, clock: t.clock };
    expect(await authenticateHandshake({ v: PROTOCOL_VERSION, token }, deps)).toEqual({
      ok: false,
      reason: "no-room",
    });
  });
});

describe("token rejections over the wire (C2)", () => {
  it.each([
    [
      "signed with another secret",
      async (b: Booted, lobby: string) => b.token({ lobby }, "o".repeat(40)),
    ],
    [
      "expired (injected clock)",
      async (b: Booted, lobby: string) => {
        const token = await b.token({ lobby });
        b.clock.advance((RACE_TOKEN_TTL_S + 1) * 1000);
        return token;
      },
    ],
    [
      "signed with the right secret but without exp",
      async (b: Booted, lobby: string) =>
        new SignJWT({ v: PROTOCOL_VERSION, sub: "usr_noexp", name: "Ada", lobby, role: "player" })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt(Math.floor(b.clock.now() / 1000))
          .sign(new TextEncoder().encode(SECRET)),
    ],
    [
      "tampered (lobby swapped)",
      async (b: Booted, lobby: string) => tamper(await b.token({ lobby: b.lobby() }), lobby),
    ],
  ] as const)("refuses a token %s with bad-token; roster unchanged", async (_, make) => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const client = t.connect({ v: PROTOCOL_VERSION, token: await make(t, lobby) });
    expect(await connectError(client)).toBe("bad-token");
    expect(await t.server.registry.members(lobby)).toEqual([]);
  });
});

/** Seats `usr_a` (desk 1) and `usr_b` (desk 2) and moves the room to `running`. */
async function runningRoom(b: Booted) {
  const lobby = await b.openRoom();
  const { registry } = b.server;
  await registry.join(lobby, { userId: "usr_a", name: "Ada" });
  await registry.join(lobby, { userId: "usr_b", name: "Bob" });
  await registry.startRace(lobby, {
    race: {
      raceId: "6f1c2a4e-8b9d-4c3e-9f0a-1b2c3d4e5f60",
      text: "Le dossier.",
      language: "fr",
      wordCount: 2,
      t0: b.clock.now(),
      timerS: null,
    },
    endAt: b.clock.now() + 60_000,
    desks: [
      { desk: 1, userId: "usr_a", name: "Ada", isBot: false },
      { desk: 2, userId: "usr_b", name: "Bob", isBot: false },
    ],
  });
  await registry.setPhase(lobby, "running");
  return lobby;
}

describe("resume keys at the handshake (#178 C4)", () => {
  const KEY_A = "a1".repeat(32);
  const KEY_B = "b2".repeat(32);
  const KEY_OTHER_LOBBY = "c3".repeat(32);

  async function setup() {
    t = await boot(process.env.REDIS_URL);
    const lobby = await runningRoom(t);
    const entries = new Map<string, ResumeEntry>([
      [KEY_A, { lobbyId: lobby, userId: "usr_a", desk: 1 }],
      [KEY_B, { lobbyId: lobby, userId: "usr_b", desk: 2 }],
      [KEY_OTHER_LOBBY, { lobbyId: t.lobby(), userId: "usr_a", desk: 1 }],
    ]);
    const lookup = vi.fn(async (key: string) => entries.get(key) ?? null);
    const deps = {
      secret: SECRET,
      registry: t.server.registry,
      clock: t.clock,
      resumeKeys: { lookup },
    };
    const as = async (sub: string, resumeKey?: string, secret = SECRET) =>
      authenticateHandshake(
        { v: PROTOCOL_VERSION, token: await t!.token({ lobby, sub }, secret), resumeKey },
        deps,
      );
    return { lobby, lookup, as };
  }

  it("resumes only a key bound to the token's lobby and sub", async () => {
    const { as } = await setup();
    expect(await as("usr_a", KEY_A)).toMatchObject({ ok: true, resume: true });
    // A member with another user's key, a key of another lobby, a made-up key or none: plain join.
    expect(await as("usr_a", KEY_B)).toMatchObject({ ok: true, resume: false });
    expect(await as("usr_a", KEY_OTHER_LOBBY)).toMatchObject({ ok: true, resume: false });
    expect(await as("usr_a", "f0".repeat(32))).toMatchObject({ ok: true, resume: false });
    expect(await as("usr_a")).toMatchObject({ ok: true, resume: false });
  });

  it("refuses a non-member with in-progress whatever key it sends", async () => {
    const { as } = await setup();
    for (const key of [KEY_A, KEY_B, KEY_OTHER_LOBBY, "f0".repeat(32)]) {
      expect(await as("usr_new", key)).toEqual({ ok: false, reason: "in-progress" });
    }
  });

  it("never reads a key before the token verifies: bad-token, no lookup", async () => {
    const { as, lookup } = await setup();
    expect(await as("usr_a", KEY_A, "w".repeat(40))).toEqual({ ok: false, reason: "bad-token" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("ignores a key while the room waits (no lookup) and when the lookup fails", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const lookup = vi.fn(async () => {
      throw new Error("redis down");
    });
    const deps = {
      secret: SECRET,
      registry: t.server.registry,
      clock: t.clock,
      resumeKeys: { lookup },
    };
    const auth = { v: PROTOCOL_VERSION, token: await t.token({ lobby }), resumeKey: KEY_A };
    expect(await authenticateHandshake(auth, deps)).toMatchObject({ ok: true, resume: false });
    expect(lookup).not.toHaveBeenCalled();

    const running = await runningRoom(t);
    const member = {
      v: PROTOCOL_VERSION,
      token: await t.token({ lobby: running, sub: "usr_a" }),
      resumeKey: KEY_A,
    };
    expect(await authenticateHandshake(member, deps)).toMatchObject({ ok: true, resume: false });
    expect(lookup).toHaveBeenCalledOnce();
  });
});
