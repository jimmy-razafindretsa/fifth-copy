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

  it.each([
    ["no auth", () => undefined, "version"],
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
