import { describe, expect, it } from "vitest";
import { SignJWT, base64url } from "jose";
import { PROTOCOL_VERSION, RACE_TOKEN_TTL_S } from "@fifth-copy/protocol";
import { verifyRaceToken } from "./race-token";

const secret = "s".repeat(32);
const now = 1_767_225_600;
const claims = { v: PROTOCOL_VERSION, sub: "usr_1", name: "Ada", lobby: "lob_1", role: "player" };

// Built with jose directly, never with the web signer: the race server never imports src/.
function sign(payload: Record<string, unknown>, key = secret, iat = now) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + RACE_TOKEN_TTL_S)
    .sign(new TextEncoder().encode(key));
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
    ["a wrong secret", async () => sign(claims, "w".repeat(32)), now],
    ["an expired token", async () => sign(claims), now + RACE_TOKEN_TTL_S + 1],
    ["a tampered payload", async () => tamper(await sign(claims)), now],
    ["an alg: none token", async () => algNone(), now],
    ["claims with v: 1", async () => sign({ ...claims, v: 1 }), now],
    ["a missing claim", async () => sign({ ...claims, lobby: undefined }), now],
    ["garbage", async () => "not.a.jwt", now],
  ])("rejects %s as bad-token", async (_, make, at) => {
    expect(await verifyRaceToken(await make(), secret, at)).toEqual({
      ok: false,
      reason: "bad-token",
    });
  });
});
