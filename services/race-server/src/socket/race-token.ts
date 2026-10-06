import { jwtVerify } from "jose";
import {
  RACE_TOKEN_TTL_S,
  raceTokenClaimsSchema,
  type RaceTokenClaims,
} from "@fifth-copy/protocol";

export type VerifyRaceTokenResult =
  { ok: true; claims: RaceTokenClaims } | { ok: false; reason: "bad-token" };

// Verifies the web-minted race token (ADR 0006, 0009). HS256 only; every failure (signature,
// expiry, algorithm, claim shape or version) is the same `bad-token` so callers leak nothing.
// The verifier enforces the 5-minute lifetime itself (ADR 0009): `exp` and `iat` are required,
// `iat` is neither in the future nor older than RACE_TOKEN_TTL_S, and `exp - iat` is at most
// RACE_TOKEN_TTL_S. No clock tolerance: web and race server share one host clock (ADR 0012).
export async function verifyRaceToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<VerifyRaceTokenResult> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      currentDate: new Date(now * 1000),
      requiredClaims: ["exp", "iat"],
      maxTokenAge: RACE_TOKEN_TTL_S,
    });
    // jose validated both as numbers (requiredClaims); it does not bound the lifetime itself.
    if (payload.exp! - payload.iat! > RACE_TOKEN_TTL_S) return { ok: false, reason: "bad-token" };
    const parsed = raceTokenClaimsSchema.safeParse(payload);
    return parsed.success ? { ok: true, claims: parsed.data } : { ok: false, reason: "bad-token" };
  } catch {
    return { ok: false, reason: "bad-token" };
  }
}
