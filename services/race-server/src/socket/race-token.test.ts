import { describe, expect, it } from "vitest";
import { SignJWT, base64url } from "jose";
import { PROTOCOL_VERSION, RACE_TOKEN_TTL_S } from "@fifth-copy/protocol";
import { verifyRaceToken } from "./race-token";

const secret = "s".repeat(32);
const now = 1_767_225_600;
const claims = { v: PROTOCOL_VERSION, sub: "usr_1", name: "Ada", lobby: "lob_1", role: "player" };

// Built with jose directly, never with the web signer: the race server never imports src/.
// `iat`/`exp` default to the web minter's shape (iat now, exp now + TTL); `null` omits the claim.
function sign(
  payload: Record<string, unknown>,
  key = secret,
  {
    iat = now,
    exp = iat === null ? now + RACE_TOKEN_TTL_S : iat + RACE_TOKEN_TTL_S,
  }: {
    iat?: number | null;
    exp?: number | null;
  } = {},
) {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });
  if (iat !== null) jwt.setIssuedAt(iat);
  if (exp !== null) jwt.setExpirationTime(exp);
  return jwt.sign(new TextEncoder().encode(key));
}

// Signs raw registered claims (string or float `exp`), which SignJWT setters would normalise.
function signRaw(payload: Record<string, unknown>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));
}

function tamper(token: string) {
  const [header, , signature] = token.split(".");
  const forged = base64url.encode(
    JSON.stringify({ ...claims, role: "host", iat: now, exp: now + 300 }),
  );
  return `${header}.${forged}.${signature}`;
}

function algNone() {
  const header = base64url.encode(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64url.encode(JSON.stringify({ ...claims, iat: now, exp: now + 300 }));
  return `${header}.${payload}.`;
}

describe("verifyRaceToken", () => {
  it("accepts a token signed with the same secret and returns the parsed claims", async () => {
    const result = await verifyRaceToken(await sign(claims), secret, now + 10);
    expect(result).toEqual({ ok: true, claims });
  });

  it.each([
    ["at mint time", now],
    ["299 s later", now + RACE_TOKEN_TTL_S - 1],
  ])("accepts a web-like token (iat now, exp now + TTL) %s", async (_, at) => {
    expect(await verifyRaceToken(await sign(claims), secret, at)).toEqual({ ok: true, claims });
  });

  it.each([
    ["a wrong secret", async () => sign(claims, "w".repeat(32)), now],
    ["an expired token", async () => sign(claims), now + RACE_TOKEN_TTL_S + 1],
    ["a tampered payload", async () => tamper(await sign(claims)), now],
    ["an alg: none token", async () => algNone(), now],
    ["claims with v: 1", async () => sign({ ...claims, v: 1 }), now],
    ["a missing claim", async () => sign({ ...claims, lobby: undefined }), now],
    ["garbage", async () => "not.a.jwt", now],
    ["a token without exp", async () => sign(claims, secret, { exp: null }), now],
    ["a token without iat", async () => sign(claims, secret, { iat: null }), now],
    [
      "a lifetime over the TTL (exp - iat = TTL + 1)",
      async () => sign(claims, secret, { exp: now + RACE_TOKEN_TTL_S + 1 }),
      now,
    ],
    [
      "an iat older than the TTL with exp still ahead",
      async () => sign(claims, secret, { iat: now - RACE_TOKEN_TTL_S - 1, exp: now + 10 }),
      now,
    ],
    [
      "an iat in the future",
      async () => sign(claims, secret, { iat: now + 1, exp: now + 1 + RACE_TOKEN_TTL_S }),
      now,
    ],
    ["a string exp", async () => signRaw({ ...claims, iat: now, exp: String(now + 300) }), now],
    ["a string iat", async () => signRaw({ ...claims, iat: String(now), exp: now + 300 }), now],
    [
      "a float exp past the TTL",
      async () => signRaw({ ...claims, iat: now, exp: now + 300.5 }),
      now,
    ],
  ])("rejects %s as bad-token", async (_, make, at) => {
    expect(await verifyRaceToken(await make(), secret, at)).toEqual({
      ok: false,
      reason: "bad-token",
    });
  });
});
