import { base64url, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, RACE_TOKEN_TTL_S } from "@fifth-copy/protocol";
import { boot, connectError, SECRET, type Booted } from "../testing/harness";
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

describe("spectator tokens (#557)", () => {
  it("refuses a valid spectator token as bad-token until the spectator channel lands (#187)", async () => {
    t = await boot(process.env.REDIS_URL);
    const lobby = await t.openRoom();
    const token = await t.token({ lobby, role: "spectator" });
    const deps = { secret: SECRET, registry: t.server.registry, clock: t.clock };
    expect(await authenticateHandshake({ v: PROTOCOL_VERSION, token }, deps)).toEqual({
      ok: false,
      reason: "bad-token",
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
