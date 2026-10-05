import { jwtVerify } from "jose";
import { raceTokenClaimsSchema, type RaceTokenClaims } from "@fifth-copy/protocol";

export type VerifyRaceTokenResult =
  | { ok: true; claims: RaceTokenClaims }
  | { ok: false; reason: "bad-token" };

// Verifies the web-minted race token (ADR 0006, 0009). HS256 only; every failure (signature,
// expiry, algorithm, claim shape or version) is the same `bad-token` so callers leak nothing.
export async function verifyRaceToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<VerifyRaceTokenResult> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      currentDate: new Date(now * 1000),
    });
    const parsed = raceTokenClaimsSchema.safeParse(payload);
    return parsed.success ? { ok: true, claims: parsed.data } : { ok: false, reason: "bad-token" };
  } catch {
    return { ok: false, reason: "bad-token" };
  }
}
