import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";
import {
  INTERNAL_HMAC_TEST_VECTOR,
  PROTOCOL_VERSION,
  RACE_TOKEN_TTL_S,
  type RaceTokenClaims,
} from "@fifth-copy/protocol";
import { signRaceToken } from "./race-token";

const secret = "s".repeat(32);
const claims: RaceTokenClaims = {
  v: PROTOCOL_VERSION,
  sub: "usr_1",
  name: "Ada",
  lobby: "lob_1",
  role: "host",
};

describe("signRaceToken", () => {
  it("produces an HS256 JWT carrying the claims, valid for RACE_TOKEN_TTL_S", async () => {
    const now = 1_767_225_600;
    const token = await signRaceToken(claims, { secret, now });
    expect(decodeProtectedHeader(token).alg).toBe("HS256");
    const payload = decodeJwt(token);
    expect(payload).toMatchObject(claims);
    expect(payload.iat).toBe(now);
    expect(payload.exp).toBe(now + RACE_TOKEN_TTL_S);
    expect(RACE_TOKEN_TTL_S).toBe(300);
  });

  it("is deterministic for an injected now and differs per secret", async () => {
    const a = await signRaceToken(claims, { secret, now: 1 });
    expect(await signRaceToken(claims, { secret, now: 1 })).toBe(a);
    expect(await signRaceToken(claims, { secret: "t".repeat(32), now: 1 })).not.toBe(a);
  });

  it("defaults now to the current time", async () => {
    const before = Math.floor(Date.now() / 1000);
    const { iat } = decodeJwt(await signRaceToken(claims, { secret }));
    expect(iat).toBeGreaterThanOrEqual(before);
    expect(iat).toBeLessThanOrEqual(before + 2);
  });
});

describe("INTERNAL_HMAC_TEST_VECTOR", () => {
  it("recomputes with node:crypto over `${timestamp}.${body}`", () => {
    const { secret: key, timestamp, body, signature } = INTERNAL_HMAC_TEST_VECTOR;
    const mac = createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");
    expect(mac).toBe(signature);
  });
});
